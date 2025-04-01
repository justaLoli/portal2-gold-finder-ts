export interface DemoFile {
	file: File;
	sarSplits: any;
	mapName: string;
	playbackTicks: number | undefined;
	player: string;
	parsed: boolean;
}

export interface ShortenedDemoFile {
	fileName: string | undefined;
	playbackTicks: number | undefined;
}
export type GroupedDemo = Record<string, {files: ShortenedDemoFile[]; sumTick: number;}>
// type GroupedDemo = {
// 	[mapName: string]: {
// 		files: ShortenedDemoFile[];
// 		sumTick: number;
// 	};
// };