import type { State } from "../state.ts";
import { page } from "./page.ts";
import { pen } from "./pen.ts";
import { polygons } from "./polygons.ts";
import { setup } from "./setup.ts";
import { vectors } from "./vectors.ts";

/** Executes one command against the shared state, given its numeric parameters. */
export type Handler = (state: State, params: number[]) => void;

/** Mnemonic → handler. Add a command group by spreading its module in here. */
export const registry: Record<string, Handler> = {
	...setup,
	...pen,
	...vectors,
	...page,
	...polygons,
};
