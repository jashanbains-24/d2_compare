import fs from "fs/promises";
import { expect } from "chai";
import request from "supertest";
import { StatusCodes } from "http-status-codes";
import { createApp } from "../../src/App";
import { createReusableServer } from "../TestServer";

const { OK, CREATED, NO_CONTENT, UNPROCESSABLE_ENTITY } = StatusCodes;
const datadir = "./data" as const;

const baseBody = {
	name: "Hugh Dempster Pavilion",
	address: "6245 Agronomy Road V6T 1Z4",
	lat: 49.26125,
	lon: -123.24807,
};

describe("Campus PUT (D1)", function () {
	const testServer = createReusableServer();
	const app = testServer.server;

	beforeEach(async () => {
		testServer.setHandler(await createApp({ datadir }));
	});
	afterEach(async () => {
		await fs.rm(datadir, { recursive: true, force: true });
	});
	after(async () => {
		await testServer.close();
	});

	it("PUT with campus creates building with campus", async () => {
		const res = await request(app)
			.put("/api/v2/buildings/DMP")
			.send({ ...baseBody, campus: "vancouver campus" });
		expect(res).to.have.property("status", CREATED);
		expect(res.body).to.have.property("campus", "vancouver campus");
	});

	it("PUT without campus keeps existing campus", async () => {
		await request(app)
			.put("/api/v2/buildings/DMP")
			.send({ ...baseBody, campus: "vancouver campus" });
		const put = await request(app)
			.put("/api/v2/buildings/DMP")
			.send({ ...baseBody, name: "New Name" });
		expect(put).to.have.property("status", NO_CONTENT);

		const res = await request(app).get("/api/v2/buildings/DMP");
		expect(res.body).to.have.property("name", "New Name");
		expect(res.body).to.have.property("campus", "vancouver campus");
	});

	it("PUT with a new campus replaces the old one", async () => {
		await request(app)
			.put("/api/v2/buildings/DMP")
			.send({ ...baseBody, campus: "vancouver campus" });
		await request(app)
			.put("/api/v2/buildings/DMP")
			.send({ ...baseBody, campus: "okanagan campus" });

		const res = await request(app).get("/api/v2/buildings/DMP");
		expect(res.body).to.have.property("campus", "okanagan campus");
	});

	it("PUT with non-string campus fails validation", async () => {
		const res = await request(app)
			.put("/api/v2/buildings/DMP")
			.send({ ...baseBody, campus: 123 });
		expect(res).to.have.property("status", UNPROCESSABLE_ENTITY);
		expect(res.body).to.deep.equal({
			error: "Validation failed",
			fields: { campus: "expected a string" },
		});
	});

	it("PUT with campus null fails validation", async () => {
		const res = await request(app)
			.put("/api/v2/buildings/DMP")
			.send({ ...baseBody, campus: null });
		expect(res).to.have.property("status", UNPROCESSABLE_ENTITY);
		expect(res.body.fields).to.have.property("campus", "expected a string");
	});

	it("invalid campus does not modify the existing building", async () => {
		await request(app)
			.put("/api/v2/buildings/DMP")
			.send({ ...baseBody, campus: "vancouver campus" });
		await request(app)
			.put("/api/v2/buildings/DMP")
			.send({ ...baseBody, name: "Should Not Save", campus: 123 });

		const res = await request(app).get("/api/v2/buildings/DMP");
		expect(res.body).to.have.property("name", "Hugh Dempster Pavilion");
		expect(res.body).to.have.property("campus", "vancouver campus");
	});
});
