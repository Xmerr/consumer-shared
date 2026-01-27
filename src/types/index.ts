import type { Channel, ConsumeMessage } from "amqplib";

export type ConnectionState = "disconnected" | "connecting" | "connected";

export type LogLevel = "debug" | "info" | "warn" | "error";

export interface LokiConfig {
	host: string;
	labels?: Record<string, string>;
}

export interface LoggerOptions {
	level?: LogLevel;
	pretty?: boolean;
	loki?: LokiConfig;
	job: string;
	environment: string;
}

export interface ConnectionManagerOptions {
	url: string;
	reconnectAttempts?: number;
	reconnectDelayMs?: number;
	logger: ILogger;
}

export interface BaseConsumerOptions {
	channel: Channel;
	exchange: string;
	queue: string;
	routingKey: string;
	dlqHandler: IDlqHandler;
	logger: ILogger;
	prefetchCount?: number;
}

export interface BasePublisherOptions {
	channel: Channel;
	exchange: string;
	logger: ILogger;
}

export interface DlqHandlerOptions {
	channel: Channel;
	exchange: string;
	queue: string;
	serviceName: string;
	logger: ILogger;
	maxRetries?: number;
}

export interface IConnectionManager {
	connect(): Promise<void>;
	getChannel(): Channel;
	close(): Promise<void>;
	on(
		event: "reconnected" | "error",
		handler: (...args: unknown[]) => void,
	): void;
}

export interface IConsumer {
	start(): Promise<void>;
	stop(): Promise<void>;
}

export interface IPublisher {
	publish(routingKey: string, content: Record<string, unknown>): Promise<void>;
}

export interface IDlqHandler {
	setup(): Promise<void>;
	handleRetryableError(message: ConsumeMessage, error: Error): Promise<void>;
	handleNonRetryableError(message: ConsumeMessage, error: Error): Promise<void>;
}

export interface ILogger {
	debug(msg: string, context?: Record<string, unknown>): void;
	info(msg: string, context?: Record<string, unknown>): void;
	warn(msg: string, context?: Record<string, unknown>): void;
	error(msg: string, context?: Record<string, unknown>): void;
	child(bindings: Record<string, unknown>): ILogger;
}
