/**
 * Lightweight mock of the VS Code API for unit tests.
 *
 * Each test creates a fresh instance; state resets between tests.
 * Only the surface we actually call is implemented — if a test hits
 * a stub that throws, that test needs to wire up the missing mock.
 */

// ---- Fake memento (in-memory globalState) ----

export class FakeMemento {
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	private store = new Map<string, any>();

	get(key: string): unknown {
		return this.store.get(key);
	}

	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	update(key: string, value: any): Thenable<void> {
		this.store.set(key, value);
		return Promise.resolve();
	}

	reset(): void {
		this.store.clear();
	}
}

// ---- Fake SecretStorage ----

export class FakeSecrets {
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	private store = new Map<string, any>();

	get(key: string): Thenable<string | undefined> {
		return Promise.resolve(this.store.get(key) as string | undefined);
	}

	store(key: string, value: string): Thenable<void> {
		this.store.set(key, value);
		return Promise.resolve();
	}

	delete(key: string): Thenable<void> {
		this.store.delete(key);
		return Promise.resolve();
	}

	reset(): void {
		this.store.clear();
	}
}

// ---- Shared mock state (process-wide singleton, reset each test) ----

export const mockState = {
	informationMessages: [] as string[],
	warningMessages: [] as string[],
	errorMessages: [] as string[],
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	quickPickItems: [] as any[],
	executedCommands: [] as string[],

	reset(): void {
		this.informationMessages = [];
		this.warningMessages = [];
		this.errorMessages = [];
		this.quickPickItems = [];
		this.executedCommands = [];
	},
};

// Process‑wide mock of `vscode.workspace.getConfiguration`.
// Assign `mockConfig['minimax.apiBaseUrl'] = 'https://...'` before
// a test, then clean up in `afterEach`.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const mockConfig: Record<string, any> = {};

// Track calls to vscode.env.openExternal so tests can assert the
// right platform URLs were targeted (e.g. 402 top‑up link).
export function getOpenExternalCalls(): string[] {
	const calls: unknown = (mockConfig as Record<string, unknown>).openExternalCalls;
	return Array.isArray(calls) ? (calls as string[]) : [];
}
