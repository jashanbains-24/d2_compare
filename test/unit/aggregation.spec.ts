import fs from "fs/promises";
import { expect } from "chai";
import request from "supertest";
import { StatusCodes } from "http-status-codes";
import { createApp } from "../../src/App";
import { createReusableServer } from "../TestServer";

const { OK } = StatusCodes;
const datadir = "./data" as const;

describe("Aggregation (D1 Request 2)", function () {
	const testServer = createReusableServer();
	const app = testServer.server;

	async function seedRooms(): Promise<void> {
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
		const rooms = [
			{
				id: "DMP_110",
				building: "DMP",
				number: "110",
				type: "Open Design General Purpose",
				furniture: "Fixed Tables",
				seats: 120,
			},
			{ id: "DMP_310", building: "DMP", number: "310", type: "General Purpose", furniture: "Fixed Tables", seats: 160 },
			{ id: "EME_1101", building: "EME", number: "1101", type: "Case Style", furniture: "Moveable Tables", seats: 40 },
			{
				id: "MCLD_2018",
				building: "MCLD",
				number: "2018",
				type: "Open Design General Purpose",
				furniture: "Fixed Tables",
				seats: 124,
			},
		];
		for (const { id, ...room } of rooms) {
			await request(app)
				.put(`/api/v2/buildings/${room.building}/rooms/${id}`)
				.send({ ...room, href: `https://example.com/${id}` });
		}
	}

	async function seedSections(): Promise<void> {
		await request(app).put("/api/v1/courses/cpsc210").send({
			title: "Software Construction",
			dept: "cpsc",
			code: "210",
		});
		await request(app).put("/api/v1/courses/cpsc310").send({
			title: "Introduction to Software Engineering",
			dept: "cpsc",
			code: "310",
		});
		const sections = [
			{ course: "cpsc210", id: "2024w201", avg: 79.5 },
			{ course: "cpsc310", id: "2024w201", avg: 80.4 },
			{ course: "cpsc310", id: "2024w202", avg: 82.5 },
			{ course: "cpsc310", id: "2024w203", avg: 70.1 },
		];
		for (const { course, id, avg } of sections) {
			await request(app)
				.put(`/api/v1/courses/${course}/sections/${id}`)
				.send({ instructor: "someone", year: 2024, avg, pass: 100, fail: 0, audit: 0 });
		}
	}

	function searchRooms(query: any): request.Test {
		return request(app).post("/api/v2/search").send({ kind: "facilities", query });
	}

	beforeEach(async () => {
		testServer.setHandler(await createApp({ datadir }));
		await seedRooms();
	});
	afterEach(async () => {
		await fs.rm(datadir, { recursive: true, force: true });
	});
	after(async () => {
		await testServer.close();
	});

	it("MAX and MIN per group return the original numbers", async () => {
		const res = await searchRooms({
			WHERE: {},
			OPTIONS: { COLUMNS: ["building", "maxSeats", "minSeats"], ORDER: "building" },
			TRANSFORMATIONS: {
				GROUP: ["building"],
				APPLY: [{ maxSeats: { MAX: "seats" } }, { minSeats: { MIN: "seats" } }],
			},
		});
		expect(res).to.have.property("status", OK);
		expect(res.body).to.deep.equal([
			{ building: "DMP", maxSeats: 160, minSeats: 120 },
			{ building: "EME", maxSeats: 40, minSeats: 40 },
			{ building: "MCLD", maxSeats: 124, minSeats: 124 },
		]);
	});

	it("SUM and AVG per group", async () => {
		const res = await searchRooms({
			WHERE: {},
			OPTIONS: { COLUMNS: ["building", "sumSeats", "avgSeats"], ORDER: "building" },
			TRANSFORMATIONS: {
				GROUP: ["building"],
				APPLY: [{ sumSeats: { SUM: "seats" } }, { avgSeats: { AVG: "seats" } }],
			},
		});
		expect(res).to.have.property("status", OK);
		expect(res.body).to.deep.equal([
			{ building: "DMP", sumSeats: 280, avgSeats: 140 },
			{ building: "EME", sumSeats: 40, avgSeats: 40 },
			{ building: "MCLD", sumSeats: 124, avgSeats: 124 },
		]);
	});

	it("COUNT counts unique values only", async () => {
		const res = await searchRooms({
			WHERE: {},
			OPTIONS: { COLUMNS: ["furniture", "typeCount", "buildingCount"], ORDER: "furniture" },
			TRANSFORMATIONS: {
				GROUP: ["furniture"],
				APPLY: [{ typeCount: { COUNT: "type" } }, { buildingCount: { COUNT: "building" } }],
			},
		});
		expect(res).to.have.property("status", OK);
		// Fixed Tables has 3 rooms, but only 2 distinct types and 2 distinct buildings
		expect(res.body).to.deep.equal([
			{ furniture: "Fixed Tables", typeCount: 2, buildingCount: 2 },
			{ furniture: "Moveable Tables", typeCount: 1, buildingCount: 1 },
		]);
	});

	it("multiple GROUP keys split groups on every key", async () => {
		const res = await searchRooms({
			WHERE: {},
			OPTIONS: {
				COLUMNS: ["type", "furniture", "rooms"],
				ORDER: { dir: "UP", keys: ["type", "furniture"] },
			},
			TRANSFORMATIONS: {
				GROUP: ["type", "furniture"],
				APPLY: [{ rooms: { COUNT: "number" } }],
			},
		});
		expect(res).to.have.property("status", OK);
		expect(res.body).to.deep.equal([
			{ type: "Case Style", furniture: "Moveable Tables", rooms: 1 },
			{ type: "General Purpose", furniture: "Fixed Tables", rooms: 1 },
			{ type: "Open Design General Purpose", furniture: "Fixed Tables", rooms: 2 },
		]);
	});

	it("WHERE filters before grouping", async () => {
		const res = await searchRooms({
			WHERE: { GT: { seats: 100 } },
			OPTIONS: { COLUMNS: ["furniture", "rooms"] },
			TRANSFORMATIONS: {
				GROUP: ["furniture"],
				APPLY: [{ rooms: { COUNT: "number" } }],
			},
		});
		expect(res).to.have.property("status", OK);
		expect(res.body).to.deep.equal([{ furniture: "Fixed Tables", rooms: 3 }]);
	});

	it("ORDER DOWN on an applykey", async () => {
		const res = await searchRooms({
			WHERE: {},
			OPTIONS: {
				COLUMNS: ["building", "maxSeats"],
				ORDER: { dir: "DOWN", keys: ["maxSeats"] },
			},
			TRANSFORMATIONS: {
				GROUP: ["building"],
				APPLY: [{ maxSeats: { MAX: "seats" } }],
			},
		});
		expect(res).to.have.property("status", OK);
		expect(res.body.map((r: any) => r.building)).to.deep.equal(["DMP", "MCLD", "EME"]);
	});

	it("GROUP by campus puts no-campus buildings in their own group without a campus key", async () => {
		const res = await searchRooms({
			WHERE: {},
			OPTIONS: { COLUMNS: ["campus", "rooms"], ORDER: "campus" },
			TRANSFORMATIONS: {
				GROUP: ["campus"],
				APPLY: [{ rooms: { COUNT: "number" } }],
			},
		});
		expect(res).to.have.property("status", OK);
		expect(res.body).to.deep.equal([
			{ rooms: 1 },
			{ campus: "okanagan campus", rooms: 1 },
			{ campus: "vancouver campus", rooms: 2 },
		]);
	});

	it("no matching rows gives an empty result", async () => {
		const res = await searchRooms({
			WHERE: { GT: { seats: 1000 } },
			OPTIONS: { COLUMNS: ["building", "maxSeats"] },
			TRANSFORMATIONS: {
				GROUP: ["building"],
				APPLY: [{ maxSeats: { MAX: "seats" } }],
			},
		});
		expect(res).to.have.property("status", OK);
		expect(res.body).to.deep.equal([]);
	});

	it("course_offerings AVG and SUM are rounded to two decimals", async () => {
		await seedSections();
		const res = await request(app)
			.post("/api/v2/search")
			.send({
				kind: "course_offerings",
				query: {
					WHERE: {},
					OPTIONS: { COLUMNS: ["code", "avgGrade", "sumGrade", "sections"], ORDER: "code" },
					TRANSFORMATIONS: {
						GROUP: ["code"],
						APPLY: [{ avgGrade: { AVG: "avg" } }, { sumGrade: { SUM: "avg" } }, { sections: { COUNT: "avg" } }],
					},
				},
			});
		expect(res).to.have.property("status", OK);
		// cpsc310: (80.4 + 82.5 + 70.1) / 3 = 77.666... -> 77.67
		expect(res.body).to.deep.equal([
			{ code: "210", avgGrade: 79.5, sumGrade: 79.5, sections: 1 },
			{ code: "310", avgGrade: 77.67, sumGrade: 233, sections: 3 },
		]);
	});
});
