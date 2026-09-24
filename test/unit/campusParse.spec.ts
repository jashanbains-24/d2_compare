import fs from "fs/promises";
import path from "path";
import { expect } from "chai";
import request from "supertest";
import { StatusCodes } from "http-status-codes";
import { createApp } from "../../src/App";
import { createReusableServer } from "../TestServer";

const { OK, ACCEPTED } = StatusCodes;
const datadir = "./data" as const;

async function sleep(ms: number): Promise<void> {
	await new Promise((r) => setTimeout(r, ms));
}

async function waitForDatasetProcessing(app: any, url: string) {
	let status = await request(app).get(url);
	while (status.body.status === "processing") {
		await sleep(500);
		status = await request(app).get(url);
	}
	return status;
}

describe("Campus parse (D1)", function () {
	this.timeout(60000);
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

	it("uploads campus.zip and GET building includes campus vancouver campus", async () => {
		const datasetBuffer = await fs.readFile(path.resolve(__dirname, "..", "test_data", "campus.zip"));
		const post = await request(app)
			.post("/api/v2/datasets")
			.field("kind", "facilities")
			.attach("archive", datasetBuffer, "campus.zip");

		expect(post).to.have.property("status", ACCEPTED);
		await waitForDatasetProcessing(app, "/api/v2/datasets/0");

		const res = await request(app).get("/api/v2/buildings/DMP");
		expect(res).to.have.property("status", OK);
		expect(res.body).to.have.property("campus", "vancouver campus");
		// omit-key check when present: key exists with that exact string
	});

	it("dataset upload adds campus onto an existing building that lacked it", async () => {
		await request(app).put("/api/v2/buildings/DMP").send({
			name: "Hugh Dempster Pavilion",
			address: "6245 Agronomy Road V6T 1Z4",
			lat: 49.26125,
			lon: -123.24807,
		});
		// note: before Group 2, PUT won't accept campus yet

		const datasetBuffer = await fs.readFile(path.resolve(__dirname, "..", "test_data", "campus.zip"));
		await request(app)
			.post("/api/v2/datasets")
			.field("kind", "facilities")
			.attach("archive", datasetBuffer, "campus.zip");
		await waitForDatasetProcessing(app, "/api/v2/datasets/0");

		const res = await request(app).get("/api/v2/buildings/DMP");
		expect(res.body).to.have.property("campus", "vancouver campus");
	});

	it("building with no campus omits the campus key", async () => {
		await request(app).put("/api/v2/buildings/TEST").send({
			name: "Test Building",
			address: "123 Fake St",
			lat: 49.2,
			lon: -123.2,
		});
		const res = await request(app).get("/api/v2/buildings/TEST");
		expect(res).to.have.property("status", OK);
		expect(res.body).to.not.have.property("campus");
	});
});
