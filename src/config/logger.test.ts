import { beforeEach, describe, expect, it, mock } from "bun:test";
import type { ILogger, LoggerOptions } from "../types/index.js";
import { createLogger } from "./logger.js";

describe("createLogger", () => {
	const baseOptions: LoggerOptions = {
		job: "test-service",
		environment: "test",
	};

	it("should create a logger with default level", () => {
		const logger = createLogger(baseOptions);

		expect(logger).toBeDefined();
		expect(typeof logger.debug).toBe("function");
		expect(typeof logger.info).toBe("function");
		expect(typeof logger.warn).toBe("function");
		expect(typeof logger.error).toBe("function");
		expect(typeof logger.child).toBe("function");
	});

	it("should create a logger with a specified level", () => {
		const logger = createLogger({ ...baseOptions, level: "warn" });

		expect(logger).toBeDefined();
	});

	it("should log messages without context", () => {
		const logger = createLogger(baseOptions);

		expect(() => logger.debug("debug message")).not.toThrow();
		expect(() => logger.info("info message")).not.toThrow();
		expect(() => logger.warn("warn message")).not.toThrow();
		expect(() => logger.error("error message")).not.toThrow();
	});

	it("should log messages with context", () => {
		const logger = createLogger(baseOptions);
		const context = { key: "value", count: 42 };

		expect(() => logger.info("with context", context)).not.toThrow();
		expect(() => logger.error("with context", context)).not.toThrow();
	});

	it("should create a child logger with bindings", () => {
		const logger = createLogger(baseOptions);
		const child = logger.child({ component: "TestComponent" });

		expect(child).toBeDefined();
		expect(typeof child.info).toBe("function");
		expect(typeof child.child).toBe("function");
	});

	it("should create a child logger that also supports context", () => {
		const logger = createLogger(baseOptions);
		const child = logger.child({ component: "TestComponent" });

		expect(() => child.info("child message")).not.toThrow();
		expect(() =>
			child.error("child error", { detail: "something" }),
		).not.toThrow();
	});

	it("should accept pretty option without throwing", () => {
		const logger = createLogger({ ...baseOptions, pretty: true });

		expect(logger).toBeDefined();
	});

	it("should accept loki config without throwing", () => {
		const logger = createLogger({
			...baseOptions,
			loki: {
				host: "http://localhost:3101",
				labels: { extra: "label" },
			},
		});

		expect(logger).toBeDefined();
	});
});
