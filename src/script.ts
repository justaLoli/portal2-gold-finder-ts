import {GroupedDemo, DemoFile} from "./defs"
const dropZone = document.getElementById("drop-zone")! as HTMLElement;
const copyButton = document.getElementById("copy-btn")! as HTMLButtonElement;
const downloadButton = document.getElementById('download-btn')! as HTMLButtonElement;
const downloadFullButton = document.getElementById('download-full-btn')! as HTMLButtonElement;
const progressText = document.getElementById("progress-text")! as HTMLElement;
const outputText = document.getElementById("output")! as HTMLTextAreaElement;
const searchForm = document.getElementById('search-form')! as HTMLFormElement;


let fileGroupedByFolder: Record<string, GroupedDemo | DemoFile[]> = {};

// 处理拖放文件
dropZone.addEventListener("drop", async (event) => {
	// routine
	event.preventDefault();
	dropZone.classList.remove("dragover");
	
	// clear existing files
	fileGroupedByFolder = {};
	
	// get all files
	progressText.innerText = "Getting file index..."; // hint

	const items = event.dataTransfer!.items;
	const tasks: Promise<void>[] = [];
	for (const item of items) {
		if (item.kind === "file") {
			const entry = item.webkitGetAsEntry();
			if (entry?.isDirectory) {
				tasks.push(handleDirectoryEntry(entry! as FileSystemDirectoryEntry, entry!.name + "/"));
			} else if (entry?.isFile) {
				tasks.push(handleFileEntry(entry! as FileSystemFileEntry, "/"));
			}
		}
	}
	await Promise.all(tasks);

	// Start the process
    progressText.innerText = "Get file index done. Preparing parse..."
    const total = Object.keys(fileGroupedByFolder).length;
    let done = 0;
    const MAX_WORKERS = navigator.hardwareConcurrency || 4;
    interface WorkerWithIdle extends Worker{
    	idle: boolean;
    }
    const workers: WorkerWithIdle[] = [];
    const taskQueue:{ directory: string, fileList: DemoFile[] }[] = [];
    let activateWorkers = 0;
    for (let i = 0; i < MAX_WORKERS; i++ ) {
    	/*
		1. 要使用URL的方式添加ts文件，这样build的时候才能对应的编译到
		2. 强制类型转换
    	*/
    	const worker = new Worker(new URL('./worker.ts', import.meta.url), {type: "module"}) as WorkerWithIdle;
    	worker.idle = true;
    	worker.onmessage = (event) => {
    		const { directory, result } = event.data;
    		fileGroupedByFolder[directory] = result;
    		activateWorkers--;
    		done++;
    		worker.idle = true;
    		processNextTask();
    	};
    	worker.onerror = (error) => {
    		console.error("work error: ", error);
    		activateWorkers--;
    		done++;
    		processNextTask();
    	};
    	workers.push(worker);
    }
    const addTask = (directory: string, fileList: DemoFile[]) => {
    	taskQueue.push({ directory, fileList });
    	processNextTask();
    };
    const processNextTask = () => {
    	if (done === total) {
    		progressText.innerText = "Parsing done.";
    		outputText.value = JSON.stringify(fileGroupedByFolder, null, 2);
    	}
    	if (activateWorkers >= MAX_WORKERS || taskQueue.length === 0) return;
    	const {directory, fileList} = taskQueue.shift()!;
    	const availableWorker = workers.find((w) => w.idle);

    	if (availableWorker) {
    		availableWorker.idle = false;
    		activateWorkers++;
    		progressText.innerText = `Parsing ${done} / ${total} folder ...`;
    		availableWorker.postMessage({ directory, fileList });
    	}
    };

    for (const directory in fileGroupedByFolder){
    	addTask(directory, fileGroupedByFolder[directory] as DemoFile[]);
    }
});
// 处理拖拽区的 hover 状态
dropZone.addEventListener("dragover", (event) => {
    event.preventDefault();
    dropZone.classList.add("dragover");
});
dropZone.addEventListener("dragleave", () => {
    dropZone.classList.remove("dragover");
});

// Filter
searchForm.addEventListener("submit", (ev) => {
    ev.preventDefault();

    const mapName = (document.getElementById('map-name') as HTMLInputElement).value;
    const minTime = parseFloat((document.getElementById('min-time') as HTMLInputElement).value);
    const maxTime = parseFloat((document.getElementById('max-time') as HTMLInputElement).value);

    const minTicks = (minTime * 60) - 1;
    const maxTicks = (maxTime * 60) + 1

    const filteredData:Record<string,GroupedDemo> = {};

    for (const folder in fileGroupedByFolder) {
        if (fileGroupedByFolder.hasOwnProperty(folder)) {
            const folderData = fileGroupedByFolder[folder] as GroupedDemo;
            for (const map in folderData) {
                if (folderData.hasOwnProperty(map) && map === mapName) {
                    const mapData = folderData[map];
                    if (mapData.sumTick >= minTicks && mapData.sumTick <= maxTicks) {
                        if (!filteredData[folder]) {
                            filteredData[folder] = {};
                        }
                        filteredData[folder][map] = mapData;
                    }
                }
            }
        }
    }

    outputText.value = JSON.stringify(filteredData, null, 2);

});

// copy and download
copyButton.addEventListener("click", () => {
    outputText.select();
    document.execCommand("copy");
    alert('Copied to clipboard!');
});
downloadButton.addEventListener("click", () => {
    downloadJSON(outputText.value, "output.json");
});
downloadFullButton.addEventListener("click", () => {
    const fullJSON = JSON.stringify(fileGroupedByFolder, null, 2);
    downloadJSON(fullJSON, 'full_data.json');
});

// init textarea
window.onload = () => {outputText.value = "";};

// File Sniffer
async function handleDirectoryEntry (
	entry: FileSystemDirectoryEntry,
	rootPath: string
) {
	const reader = entry.createReader();
	const readEntries = async (): Promise<FileSystemEntry[]> => {
		return new Promise((resolve, reject) => {
			reader.readEntries((entries) => {
				if (entries) resolve(entries);
				else reject(new Error("Failed to read entries"));
			});
		});
	};
	let entries = await readEntries();
	let tasks: Promise<void>[] = [];

	for (const subEntry of entries) {
		if (subEntry.isFile) {
			tasks.push(handleFileEntry(subEntry as FileSystemFileEntry, rootPath));
		} else if (subEntry.isDirectory) {
			tasks.push(handleDirectoryEntry(subEntry as FileSystemDirectoryEntry, rootPath + subEntry.name + "/"));
		}
	}
	await Promise.all(tasks);
};
async function handleFileEntry(
	entry: FileSystemFileEntry,
	rootPath: string
) {
	const processFile = (file: File, path: string) => {
		if (!file.name.endsWith(".dem") && !file.name.endsWith(".DEM")) {
			console.log(`${file.name} not end with .dem, skipped.`);
			return;
		}
		if (!fileGroupedByFolder[path]) {
			fileGroupedByFolder[path] = [];
		}

		(fileGroupedByFolder[path] as DemoFile[]).push({
			file: file,
			sarSplits: undefined,
			mapName: "unknown",
			playbackTicks: undefined,
			player: "unknown",
			parsed: false
		});
	}

	return new Promise<void>( (resolve, reject) => {
		entry.file(
			(file) => {processFile(file, rootPath); resolve();},
			(error) => {reject(error);}
		);
	});
}

// util
function downloadJSON(json:any, filename:string) {
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}

