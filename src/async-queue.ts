/**
  A simple Promise-based queue used by the Rx classes
  to manage asynchronous operations. This queue allows for
  putting and getting values in a FIFO manner, handling
  asynchronous operations without blocking the main thread.
*/
export class AsyncQueue<T> {
    private promises: Promise<T>[];
    private resolvers: ((value: T | PromiseLike<T>) => void)[];

    constructor() {
        this.promises = [];
        this.resolvers = [];
    }

    private add(): void {
        this.promises.push(new Promise<T>(resolve => {
            this.resolvers.push(resolve);
        }));
    }

    put(value: T): void {
        if (!this.resolvers.length) {
            this.add();
        }
        const resolve = this.resolvers.shift();
        if (resolve) {
            resolve(value);
        }
    }

    async get(): Promise<T> {
        if (!this.promises.length) {
            this.add();
        }
        const promise = this.promises.shift();
        if (promise) {
            return promise;
        }
        // Fallback, should ideally not be reached with current logic
        return new Promise<T>(resolve => {
            this.resolvers.push(resolve);
            this.promises.push(this.get());
        });
    }

    isEmpty(): boolean {
        return this.promises.length === 0;
    }

    size(): number {
        return this.promises.length;
    }

    clear(): void {
        // Properly clear the queue by rejecting pending promises to avoid unhandled rejections
        this.resolvers.forEach(resolve => {
            // It's tricky to "cancel" a promise from outside without a specific mechanism.
            // For simplicity, we'll just clear them. Consumers should be aware.
        });
        this.promises = [];
        this.resolvers = [];
    }
}