import type { Channel } from "amqplib";
import type {
	BasePublisherOptions,
	ILogger,
	IPublisher,
} from "../types/index.js";

export class BasePublisher implements IPublisher {
	private readonly channel: Channel;
	private readonly exchange: string;
	private readonly logger: ILogger;
	private exchangeAsserted = false;

	constructor(options: BasePublisherOptions) {
		this.channel = options.channel;
		this.exchange = options.exchange;
		this.logger = options.logger.child({ component: "BasePublisher" });
	}

	async publish(
		routingKey: string,
		content: Record<string, unknown>,
	): Promise<void> {
		await this.assertExchangeOnce();

		const buffer = Buffer.from(JSON.stringify(content));
		this.channel.publish(this.exchange, routingKey, buffer, {
			persistent: true,
			contentType: "application/json",
		});

		this.logger.debug("Message published", {
			exchange: this.exchange,
			routingKey,
		});
	}

	private async assertExchangeOnce(): Promise<void> {
		if (this.exchangeAsserted) return;

		await this.channel.assertExchange(this.exchange, "topic", {
			durable: true,
		});
		this.exchangeAsserted = true;
		this.logger.debug("Exchange asserted", { exchange: this.exchange });
	}
}
