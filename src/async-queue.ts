/**
  A simple Promise-based queue used by the Rx classes
  to manage asynchronous operations. This queue allows for
  putting and getting values in a FIFO manner, handling
  asynchronous operations without blocking the main thread.
*/
export class AsyncQueue<T> {
    private promises: Promise<T>[];
    private resolvers: ((value: T | PromiseLike<T>) => void)[];

    /**
     * Constructs a new AsyncQueue instance.
     * Initializes an empty queue for storing promises and their resolvers.
     */
    constructor() {
        this.promises = [];
        this.resolvers = [];
    }

    private add(): void {
        this.promises.push(new Promise<T>(resolve => {
            this.resolvers.push(resolve);
        }));
    }

    /**
     * Adds a value to the end of the queue.
     * If there are pending `get` operations, this will resolve the oldest one.
     * Otherwise, the value is stored until a `get` operation is called.
     * @param value The value to add to the queue.
     */
    put(value: T): void {
        if (!this.resolvers.length) {
            this.add();
        }
        const resolve = this.resolvers.shift();
        if (resolve) {
            resolve(value);
        }
    }

    /**
     * Retrieves a value from the front of the queue.
     * If the queue is empty, this method waits until a value is added.
     * @returns A Promise that resolves with the value from the front of the queue.
     */
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

    /**
     * Checks if the queue is currently empty.
     * This checks if there are any resolved or pending promises in the queue.
     * @returns True if the queue is empty, false otherwise.
     */
    isEmpty(): boolean {
        return this.promises.length === 0;
    }

    /**
     * Gets the current number of items in the queue.
     * This represents the number of promises (resolved or pending) currently held by the queue.
     * @returns The number of items in the queue.
     */
    size(): number {
        return this.promises.length;
    }

    /**
     * Clears all items from the queue.
     * This removes all pending promises and their resolvers.
     * Note: This does not explicitly reject pending promises from `get()` calls,
     * so consumers awaiting `get()` might remain pending indefinitely if not handled.
     */
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