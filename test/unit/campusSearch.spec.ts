import fs from "fs/promises";
import { expect } from "chai";
import request from "supertest";
import { StatusCodes } from "http-status-codes";
import { createApp } from "../../src/App";
import { createReusableServer } from "../TestServer";

const { OK, BAD_REQUEST } = StatusCodes;
const datadir = "./data" as const;

describe("Campus search (D1)", function () {
	const testServer = createReusableServer();
	const app = testServer.server;

	async function seed(): Promise<void> {
		await request(app).put("/api/v2/buildings/DMP").send({
			name: "Hugh Dempster Pavilion",
			address: "6245 Agronomy Road V6T 1Z4",
			lat: 49.26117,
			lon: -123.24814,
			campus: "vancouver campus",
		});
		await request(app).put("/api/v2/buildings/EME").send({
			name: "Engineering Management Education",
			address: "1137 Alumni Ave V1V 1V7",
			lat: 49.93896,
			lon: -119.39424,
			campus: "okanagan campus",
		});
		await request(app).put("/api/v2/buildings/MCLD").send({
			name: "Hector J. MacLeod Building",
			address: "2356 Main Mall V6T 1Z4",
			lat: 49.26161,
			lon: -123.24941,
		});
		await request(app).put("/api/v2/buildings/DMP/rooms/DMP_110").send({
			building: "DMP",
			number: "110",
			type: "Open Design General Purpose",
			furniture: "Fixed Tables",
			href: "https://learningspaces.ubc.ca/classrooms/dmp-110",
			seats: 120,
		});
		await request(app).put("/api/v2/buildings/DMP/rooms/DMP_310").send({
			building: "DMP",
			number: "310",
			type: "General Purpose",
			furniture: "Fixed Tables",
			href: "https://learningspaces.ubc.ca/classrooms/dmp-310",
			seats: 160,
		});
		await request(app).put("/api/v2/buildings/EME/rooms/EME_1101").send({
			building: "EME",
			number: "1101",
			type: "Case Style",
			furniture: "Moveable Tables",
			href: "https://example.com/eme-1101",
			seats: 40,
		});
		await request(app).put("/api/v2/buildings/MCLD/rooms/MCLD_2018").send({
			building: "MCLD",
			number: "2018",
			type: "Open Design General Purpose",
			furniture: "Fixed Tables",
			href: "https://learningspaces.ubc.ca/classrooms/mcld-2018",
			seats: 124,
		});
	}

	function search(query: any): request.Test {
		return request(app).post("/api/v2/search").send({ kind: "facilities", query });
	}

	beforeEach(async () => {
		testServer.setHandler(await createApp({ datadir }));
		await seed();
	});
	afterEach(async () => {
		await fs.rm(datadir, { recursive: true, force: true });
	});
	after(async () => {
		await testServer.close();
	});

	it("IS on campus returns only rooms in that campus", async () => {
		const res = await search({
			WHERE: { IS: { campus: "vancouver campus" } },
			OPTIONS: { COLUMNS: ["building", "number", "campus"], ORDER: "number" },
		});
		expect(res).to.have.property("status", OK);
		expect(res.body).to.deep.equal([
			{ building: "DMP", number: "110", campus: "vancouver campus" },
			{ building: "DMP", number: "310", campus: "vancouver campus" },
		]);
	});

	it("IS campus wildcard excludes buildings with no campus", async () => {
		const res = await search({
			WHERE: { IS: { campus: "*" } },
			OPTIONS: { COLUMNS: ["building", "number"], ORDER: "number" },
		});
		expect(res).to.have.property("status", OK);
		expect(res.body.map((r: any) => r.building)).to.not.include("MCLD");
		expect(res.body).to.have.length(3);
	});

	it("NOT IS campus includes buildings with no campus", async () => {
		const res = await search({
			WHERE: { NOT: { IS: { campus: "vancouver campus" } } },
			OPTIONS: { COLUMNS: ["building", "number"], ORDER: "number" },
		});
		expect(res).to.have.property("status", OK);
		expect(res.body).to.deep.equal([
			{ building: "EME", number: "1101" },
			{ building: "MCLD", number: "2018" },
		]);
	});

	it("campus composes with other filters in AND", async () => {
		const res = await search({
			WHERE: { AND: [{ IS: { campus: "vancouver campus" } }, { GT: { seats: 150 } }] },
			OPTIONS: { COLUMNS: ["building", "number", "seats"] },
		});
		expect(res).to.have.property("status", OK);
		expect(res.body).to.deep.equal([{ building: "DMP", number: "310", seats: 160 }]);
	});

	it("campus in COLUMNS is omitted for buildings with no campus", async () => {
		const res = await search({
			WHERE: { IS: { building: "MCLD" } },
			OPTIONS: { COLUMNS: ["building", "number", "campus"] },
		});
		expect(res).to.have.property("status", OK);
		expect(res.body).to.have.length(1);
		expect(res.body[0]).to.not.have.property("campus");
	});

	it("ORDER by campus works when some buildings have no campus", async () => {
		const res = await search({
			WHERE: {},
			OPTIONS: {
				COLUMNS: ["building", "number", "campus"],
				ORDER: { dir: "UP", keys: ["campus", "number"] },
			},
		});
		expect(res).to.have.property("status", OK);
		expect(res.body).to.deep.equal([
			{ building: "MCLD", number: "2018" },
			{ building: "EME", number: "1101", campus: "okanagan campus" },
			{ building: "DMP", number: "110", campus: "vancouver campus" },
			{ building: "DMP", number: "310", campus: "vancouver campus" },
		]);
	});

	it("campus cannot be used in a course_offerings search", async () => {
		const res = await request(app)
			.post("/api/v2/search")
			.send({
				kind: "course_offerings",
				query: {
					WHERE: { IS: { campus: "vancouver campus" } },
					OPTIONS: { COLUMNS: ["avg"] },
				},
			});
		expect(res).to.have.property("status", BAD_REQUEST);
		expect(res.body).to.have.property("message", "Cannot mix course_offerings and facilities fields in one query");
	});
});
