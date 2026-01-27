export class RetryableError extends Error {
	constructor(
		message: string,
		public readonly code: string,
		public readonly context?: Record<string, unknown>,
	) {
		super(message);
		this.name = "RetryableError";
	}
}

export class NonRetryableError extends Error {
	constructor(
		message: string,
		public readonly code: string,
		public readonly context?: Record<string, unknown>,
	) {
		super(message);
		this.name = "NonRetryableError";
	}
}

export class ConnectionError extends Error {
	constructor(
		message: string,
		public readonly code: string,
		public readonly context?: Record<string, unknown>,
	) {
		super(message);
		this.name = "ConnectionError";
	}
}

export class ConfigurationError extends Error {
	constructor(
		message: string,
		public readonly field: string,
		public readonly context?: Record<string, unknown>,
	) {
		super(message);
		this.name = "ConfigurationError";
	}
}
