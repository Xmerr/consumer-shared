import pino from "pino";
import type { ILogger, LoggerOptions } from "../types/index.js";

interface TransportTarget {
	target: string;
	options: Record<string, unknown>;
	level?: string;
}

function buildTransportTargets(options: LoggerOptions): TransportTarget[] {
	const targets: TransportTarget[] = [];

	if (options.loki) {
		targets.push({
			target: "pino-loki",
			options: {
				host: options.loki.host,
				labels: {
					job: options.job,
					environment: options.environment,
					...options.loki.labels,
				},
				batching: true,
				interval: 5,
			},
		});
	}

	if (options.pretty) {
		targets.push({
			target: "pino-pretty",
			options: { colorize: true },
		});
	} else {
		targets.push({
			target: "pino/file",
			options: { destination: 1 },
		});
	}

	return targets;
}

function wrapPinoLogger(pinoLogger: pino.Logger): ILogger {
	return {
		debug(msg: string, context?: Record<string, unknown>): void {
			if (context) {
				pinoLogger.debug(context, msg);
			} else {
				pinoLogger.debug(msg);
			}
		},
		info(msg: string, context?: Record<string, unknown>): void {
			if (context) {
				pinoLogger.info(context, msg);
			} else {
				pinoLogger.info(msg);
			}
		},
		warn(msg: string, context?: Record<string, unknown>): void {
			if (context) {
				pinoLogger.warn(context, msg);
			} else {
				pinoLogger.warn(msg);
			}
		},
		error(msg: string, context?: Record<string, unknown>): void {
			if (context) {
				pinoLogger.error(context, msg);
			} else {
				pinoLogger.error(msg);
			}
		},
		child(bindings: Record<string, unknown>): ILogger {
			return wrapPinoLogger(pinoLogger.child(bindings));
		},
	};
}

export function createLogger(options: LoggerOptions): ILogger {
	const targets = buildTransportTargets(options);
	const transport =
		targets.length > 0 ? pino.transport({ targets }) : undefined;

	const pinoLogger = pino(
		{
			level: options.level ?? "info",
		},
		transport,
	);

	return wrapPinoLogger(pinoLogger);
}
