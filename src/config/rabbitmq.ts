import amqplib from "amqplib";
import type { Channel, ChannelModel } from "amqplib";
import { ConnectionError } from "../errors/index.js";
import type {
	ConnectionManagerOptions,
	ConnectionState,
	IConnectionManager,
	ILogger,
} from "../types/index.js";

const DEFAULT_RECONNECT_ATTEMPTS = 5;
const DEFAULT_RECONNECT_DELAY_MS = 1000;

type EventHandler = (...args: unknown[]) => void;

export class ConnectionManager implements IConnectionManager {
	private connection: ChannelModel | null = null;
	private channel: Channel | null = null;
	private currentState: ConnectionState = "disconnected";
	private readonly url: string;
	private readonly reconnectAttempts: number;
	private readonly reconnectDelayMs: number;
	private readonly logger: ILogger;
	private readonly eventHandlers: Map<string, EventHandler[]> = new Map();

	constructor(options: ConnectionManagerOptions) {
		this.url = options.url;
		this.reconnectAttempts =
			options.reconnectAttempts ?? DEFAULT_RECONNECT_ATTEMPTS;
		this.reconnectDelayMs =
			options.reconnectDelayMs ?? DEFAULT_RECONNECT_DELAY_MS;
		this.logger = options.logger.child({ component: "ConnectionManager" });
	}

	async connect(): Promise<void> {
		this.currentState = "connecting";
		this.logger.info("Connecting to RabbitMQ");

		for (let attempt = 0; attempt <= this.reconnectAttempts; attempt++) {
			try {
				this.connection = await amqplib.connect(this.url);
				this.channel = await this.connection.createChannel();
				this.currentState = "connected";
				this.setupConnectionHandlers();
				this.logger.info("Connected to RabbitMQ");
				return;
			} catch (error) {
				const isLastAttempt = attempt === this.reconnectAttempts;
				if (isLastAttempt) {
					this.currentState = "disconnected";
					throw new ConnectionError(
						`Failed to connect after ${this.reconnectAttempts + 1} attempts`,
						"ECONNFAILED",
						{ lastError: (error as Error).message },
					);
				}

				const delay = this.calculateBackoff(attempt);
				this.logger.warn("Connection attempt failed, retrying", {
					attempt: attempt + 1,
					maxAttempts: this.reconnectAttempts + 1,
					delayMs: delay,
					error: (error as Error).message,
				});
				await this.sleep(delay);
			}
		}
	}

	getChannel(): Channel {
		if (!this.channel) {
			throw new ConnectionError(
				"Channel not available — call connect() first",
				"ENOCHANNEL",
			);
		}
		return this.channel;
	}

	async close(): Promise<void> {
		this.logger.info("Closing RabbitMQ connection");
		try {
			if (this.channel) {
				await this.channel.close();
				this.channel = null;
			}
			if (this.connection) {
				await this.connection.close();
				this.connection = null;
			}
		} finally {
			this.currentState = "disconnected";
		}
		this.logger.info("RabbitMQ connection closed");
	}

	on(event: "reconnected" | "error", handler: EventHandler): void {
		const handlers = this.eventHandlers.get(event) ?? [];
		handlers.push(handler);
		this.eventHandlers.set(event, handlers);
	}

	get state(): ConnectionState {
		return this.currentState;
	}

	private emit(event: string, ...args: unknown[]): void {
		const handlers = this.eventHandlers.get(event) ?? [];
		for (const handler of handlers) {
			handler(...args);
		}
	}

	private setupConnectionHandlers(): void {
		if (!this.connection) return;

		this.connection.on("error", (error: Error) => {
			this.logger.error("RabbitMQ connection error", {
				error: error.message,
			});
			this.emit("error", error);
		});

		this.connection.on("close", () => {
			if (this.currentState === "disconnected") return;
			this.logger.warn("RabbitMQ connection closed unexpectedly");
			this.channel = null;
			this.connection = null;
			this.currentState = "disconnected";
			void this.reconnect();
		});
	}

	private async reconnect(): Promise<void> {
		this.logger.info("Attempting to reconnect");
		try {
			await this.connect();
			this.emit("reconnected");
		} catch (error) {
			this.logger.error("Reconnection failed", {
				error: (error as Error).message,
			});
			this.emit("error", error);
		}
	}

	private calculateBackoff(attempt: number): number {
		return this.reconnectDelayMs * 2 ** attempt;
	}

	private sleep(ms: number): Promise<void> {
		return new Promise((resolve) => setTimeout(resolve, ms));
	}
}
