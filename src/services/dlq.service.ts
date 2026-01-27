import type { Channel, ConsumeMessage } from "amqplib";
import type {
	DlqHandlerOptions,
	IDlqHandler,
	ILogger,
} from "../types/index.js";

const DEFAULT_MAX_RETRIES = 20;
const MAX_DELAY_MS = 16 * 60 * 60 * 1000; // 16 hours
const NOTIFICATIONS_EXCHANGE = "notifications";

export class DlqHandler implements IDlqHandler {
	private readonly channel: Channel;
	private readonly exchange: string;
	private readonly queue: string;
	private readonly serviceName: string;
	private readonly maxRetries: number;
	private readonly logger: ILogger;

	constructor(options: DlqHandlerOptions) {
		this.channel = options.channel;
		this.exchange = options.exchange;
		this.queue = options.queue;
		this.serviceName = options.serviceName;
		this.maxRetries = options.maxRetries ?? DEFAULT_MAX_RETRIES;
		this.logger = options.logger.child({ component: "DlqHandler" });
	}

	async setup(): Promise<void> {
		await this.channel.assertExchange(
			`${this.exchange}.delay`,
			"x-delayed-message",
			{
				durable: true,
				arguments: { "x-delayed-type": "topic" },
			},
		);

		await this.channel.assertExchange(`${this.exchange}.dlq`, "topic", {
			durable: true,
		});

		await this.channel.assertQueue(`${this.queue}.dlq`, { durable: true });

		await this.channel.bindQueue(
			`${this.queue}.dlq`,
			`${this.exchange}.dlq`,
			this.queue,
		);

		await this.channel.assertExchange(NOTIFICATIONS_EXCHANGE, "topic", {
			durable: true,
		});

		this.logger.info("DLQ infrastructure asserted", {
			delayExchange: `${this.exchange}.delay`,
			dlqExchange: `${this.exchange}.dlq`,
			dlqQueue: `${this.queue}.dlq`,
		});
	}

	async handleRetryableError(
		message: ConsumeMessage,
		error: Error,
	): Promise<void> {
		const headers = message.properties.headers ?? {};
		const retryCount = (headers["x-retry-count"] as number | undefined) ?? 0;
		const firstFailure =
			(headers["x-first-failure-timestamp"] as string | undefined) ??
			new Date().toISOString();

		if (retryCount >= this.maxRetries) {
			this.logger.warn("Max retries exhausted, routing to DLQ", {
				queue: this.queue,
				retryCount,
				error: error.message,
			});
			await this.routeToDlq(message, error, retryCount, firstFailure);
			await this.publishAlert(error, retryCount, message);
			this.channel.ack(message);
			return;
		}

		const delay = this.calculateDelay(retryCount);

		this.channel.publish(
			`${this.exchange}.delay`,
			message.fields.routingKey,
			message.content,
			{
				persistent: true,
				contentType: "application/json",
				headers: {
					...headers,
					"x-delay": delay,
					"x-retry-count": retryCount + 1,
					"x-first-failure-timestamp": firstFailure,
					"x-last-error": error.message,
				},
			},
		);

		this.logger.info("Message scheduled for retry", {
			queue: this.queue,
			retryCount: retryCount + 1,
			delayMs: delay,
			error: error.message,
		});

		this.channel.ack(message);
	}

	async handleNonRetryableError(
		message: ConsumeMessage,
		error: Error,
	): Promise<void> {
		const headers = message.properties.headers ?? {};
		const retryCount = (headers["x-retry-count"] as number | undefined) ?? 0;
		const firstFailure =
			(headers["x-first-failure-timestamp"] as string | undefined) ??
			new Date().toISOString();

		this.logger.warn("Non-retryable error, routing directly to DLQ", {
			queue: this.queue,
			error: error.message,
		});

		await this.routeToDlq(message, error, retryCount, firstFailure);
		await this.publishAlert(error, retryCount, message);
		this.channel.ack(message);
	}

	private async routeToDlq(
		message: ConsumeMessage,
		error: Error,
		retryCount: number,
		firstFailure: string,
	): Promise<void> {
		const headers = message.properties.headers ?? {};

		this.channel.publish(`${this.exchange}.dlq`, this.queue, message.content, {
			persistent: true,
			contentType: "application/json",
			headers: {
				...headers,
				"x-retry-count": retryCount,
				"x-first-failure-timestamp": firstFailure,
				"x-last-error": error.message,
			},
		});

		this.logger.info("Message routed to DLQ", {
			dlqQueue: `${this.queue}.dlq`,
			retryCount,
			error: error.message,
		});
	}

	private async publishAlert(
		error: Error,
		retryCount: number,
		message: ConsumeMessage,
	): Promise<void> {
		const routingKey = `notifications.dlq.${this.serviceName}`;
		let originalMessage: unknown;

		try {
			originalMessage = JSON.parse(message.content.toString());
		} catch {
			originalMessage = message.content.toString();
		}

		const alert = {
			service: this.serviceName,
			queue: this.queue,
			error: error.message,
			retryCount,
			originalMessage,
			timestamp: new Date().toISOString(),
		};

		const buffer = Buffer.from(JSON.stringify(alert));

		this.channel.publish(NOTIFICATIONS_EXCHANGE, routingKey, buffer, {
			persistent: true,
			contentType: "application/json",
		});

		this.logger.info("DLQ alert published", {
			exchange: NOTIFICATIONS_EXCHANGE,
			routingKey,
			service: this.serviceName,
		});
	}

	private calculateDelay(retryCount: number): number {
		if (retryCount === 0) return 0;
		const delay = 1000 * 2 ** (retryCount - 1);
		return Math.min(delay, MAX_DELAY_MS);
	}
}
