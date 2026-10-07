import { parseHpgl } from "@hpgl-viewer/core";

self.onmessage = (event: MessageEvent<string>) => {
	self.postMessage(parseHpgl(event.data));
};
