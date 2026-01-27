import type { Channel, ConsumeMessage } from "amqplib";
import { NonRetryableError } from "../errors/index.js";
import type {
	BaseConsumerOptions,
	IConsumer,
	IDlqHandler,
	ILogger,
} from "../types/index.js";

const DEFAULT_PREFETCH_COUNT = 10;

export abstract class BaseConsumer implements IConsumer {
	private readonly channel: Channel;
	private readonly exchange: string;
	private readonly queue: string;
	private readonly routingKey: string;
	private readonly dlqHandler: IDlqHandler;
	private readonly logger: ILogger;
	private readonly prefetchCount: number;
	private consumerTag: string | null = null;

	constructor(options: BaseConsumerOptions) {
		this.channel = options.channel;
		this.exchange = options.exchange;
		this.queue = options.queue;
		this.routingKey = options.routingKey;
		this.dlqHandler = options.dlqHandler;
		this.prefetchCount = options.prefetchCount ?? DEFAULT_PREFETCH_COUNT;
		this.logger = options.logger.child({ component: this.constructor.name });
	}

	protected abstract processMessage(
		content: Record<string, unknown>,
		message: ConsumeMessage,
	): Promise<void>;

	async start(): Promise<void> {
		await this.channel.prefetch(this.prefetchCount);

		await this.channel.assertExchange(this.exchange, "topic", {
			durable: true,
		});

		await this.channel.assertQueue(this.queue, { durable: true });

		await this.channel.bindQueue(this.queue, this.exchange, this.routingKey);

		await this.dlqHandler.setup();

		const { consumerTag } = await this.channel.consume(
			this.queue,
			(msg) => {
				void this.handleMessage(msg);
			},
			{ noAck: false },
		);
		this.consumerTag = consumerTag;

		this.logger.info("Consumer started", {
			exchange: this.exchange,
			queue: this.queue,
			routingKey: this.routingKey,
		});
	}

	async stop(): Promise<void> {
		if (this.consumerTag) {
			await this.channel.cancel(this.consumerTag);
			this.consumerTag = null;
		}
		this.logger.info("Consumer stopped", { queue: this.queue });
	}

	private async handleMessage(msg: ConsumeMessage | null): Promise<void> {
		if (!msg) {
			this.logger.warn("Received null message");
			return;
		}

		try {
			const content = JSON.parse(msg.content.toString()) as Record<
				string,
				unknown
			>;
			await this.processMessage(content, msg);
			this.channel.ack(msg);
		} catch (error) {
			await this.handleError(msg, error as Error);
		}
	}

	private async handleError(msg: ConsumeMessage, error: Error): Promise<void> {
		this.logger.error("Message processing failed", {
			queue: this.queue,
			error: error.message,
			errorType: error.constructor.name,
		});

		try {
			if (error instanceof NonRetryableError) {
				await this.dlqHandler.handleNonRetryableError(msg, error);
			} else {
				await this.dlqHandler.handleRetryableError(msg, error);
			}
		} catch (dlqError) {
			this.logger.error("DLQ handler failed, nacking message", {
				error: (dlqError as Error).message,
			});
			this.channel.nack(msg, false, false);
		}
	}
}
