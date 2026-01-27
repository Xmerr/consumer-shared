import { describe, expect, it } from "bun:test";
import {
	ConfigurationError,
	ConnectionError,
	NonRetryableError,
	RetryableError,
} from "./index.js";

describe("RetryableError", () => {
	it("should set name, message, and code", () => {
		const error = new RetryableError("timeout", "ETIMEOUT");

		expect(error).toBeInstanceOf(Error);
		expect(error).toBeInstanceOf(RetryableError);
		expect(error.name).toBe("RetryableError");
		expect(error.message).toBe("timeout");
		expect(error.code).toBe("ETIMEOUT");
		expect(error.context).toBeUndefined();
	});

	it("should include optional context", () => {
		const context = { endpoint: "/api", attempt: 3 };
		const error = new RetryableError("retry", "ERETRY", context);

		expect(error.context).toEqual(context);
	});
});

describe("NonRetryableError", () => {
	it("should set name, message, and code", () => {
		const error = new NonRetryableError("invalid payload", "EINVALID");

		expect(error).toBeInstanceOf(Error);
		expect(error).toBeInstanceOf(NonRetryableError);
		expect(error.name).toBe("NonRetryableError");
		expect(error.message).toBe("invalid payload");
		expect(error.code).toBe("EINVALID");
		expect(error.context).toBeUndefined();
	});

	it("should include optional context", () => {
		const context = { field: "email", value: "bad" };
		const error = new NonRetryableError("bad data", "EBADDATA", context);

		expect(error.context).toEqual(context);
	});
});

describe("ConnectionError", () => {
	it("should set name, message, and code", () => {
		const error = new ConnectionError("connection lost", "ECONNRESET");

		expect(error).toBeInstanceOf(Error);
		expect(error).toBeInstanceOf(ConnectionError);
		expect(error.name).toBe("ConnectionError");
		expect(error.message).toBe("connection lost");
		expect(error.code).toBe("ECONNRESET");
		expect(error.context).toBeUndefined();
	});

	it("should include optional context", () => {
		const context = { host: "localhost", port: 5672 };
		const error = new ConnectionError("refused", "ECONNREFUSED", context);

		expect(error.context).toEqual(context);
	});
});

describe("ConfigurationError", () => {
	it("should set name, message, and field", () => {
		const error = new ConfigurationError("missing value", "RABBITMQ_URL");

		expect(error).toBeInstanceOf(Error);
		expect(error).toBeInstanceOf(ConfigurationError);
		expect(error.name).toBe("ConfigurationError");
		expect(error.message).toBe("missing value");
		expect(error.field).toBe("RABBITMQ_URL");
		expect(error.context).toBeUndefined();
	});

	it("should include optional context", () => {
		const context = { expected: "string", received: "undefined" };
		const error = new ConfigurationError("invalid", "LOG_LEVEL", context);

		expect(error.context).toEqual(context);
	});
});
