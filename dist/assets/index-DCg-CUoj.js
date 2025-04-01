(function polyfill() {
  const relList = document.createElement("link").relList;
  if (relList && relList.supports && relList.supports("modulepreload")) {
    return;
  }
  for (const link of document.querySelectorAll('link[rel="modulepreload"]')) {
    processPreload(link);
  }
  new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      if (mutation.type !== "childList") {
        continue;
      }
      for (const node of mutation.addedNodes) {
        if (node.tagName === "LINK" && node.rel === "modulepreload")
          processPreload(node);
      }
    }
  }).observe(document, { childList: true, subtree: true });
  function getFetchOpts(link) {
    const fetchOpts = {};
    if (link.integrity) fetchOpts.integrity = link.integrity;
    if (link.referrerPolicy) fetchOpts.referrerPolicy = link.referrerPolicy;
    if (link.crossOrigin === "use-credentials")
      fetchOpts.credentials = "include";
    else if (link.crossOrigin === "anonymous") fetchOpts.credentials = "omit";
    else fetchOpts.credentials = "same-origin";
    return fetchOpts;
  }
  function processPreload(link) {
    if (link.ep)
      return;
    link.ep = true;
    const fetchOpts = getFetchOpts(link);
    fetch(link.href, fetchOpts);
  }
})();
const dropZone = document.getElementById("drop-zone");
const copyButton = document.getElementById("copy-btn");
const downloadButton = document.getElementById("download-btn");
const downloadFullButton = document.getElementById("download-full-btn");
const progressText = document.getElementById("progress-text");
const outputText = document.getElementById("output");
const searchForm = document.getElementById("search-form");
let fileGroupedByFolder = {};
dropZone.addEventListener("drop", async (event) => {
  event.preventDefault();
  dropZone.classList.remove("dragover");
  fileGroupedByFolder = {};
  progressText.innerText = "Getting file index...";
  const items = event.dataTransfer.items;
  const tasks = [];
  for (const item of items) {
    if (item.kind === "file") {
      const entry = item.webkitGetAsEntry();
      if (entry == null ? void 0 : entry.isDirectory) {
        tasks.push(handleDirectoryEntry(entry, entry.name + "/"));
      } else if (entry == null ? void 0 : entry.isFile) {
        tasks.push(handleFileEntry(entry, "/"));
      }
    }
  }
  await Promise.all(tasks);
  progressText.innerText = "Get file index done. Preparing parse...";
  const total = Object.keys(fileGroupedByFolder).length;
  let done = 0;
  const MAX_WORKERS = navigator.hardwareConcurrency || 4;
  const workers = [];
  const taskQueue = [];
  let activateWorkers = 0;
  for (let i = 0; i < MAX_WORKERS; i++) {
    const worker = new Worker(new URL(
      /* @vite-ignore */
      "/assets/worker-CNip85YA.js",
      import.meta.url
    ), { type: "module" });
    worker.idle = true;
    worker.onmessage = (event2) => {
      const { directory, result } = event2.data;
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
  const addTask = (directory, fileList) => {
    taskQueue.push({ directory, fileList });
    processNextTask();
  };
  const processNextTask = () => {
    if (done === total) {
      progressText.innerText = "Parsing done.";
      outputText.value = JSON.stringify(fileGroupedByFolder, null, 2);
    }
    if (activateWorkers >= MAX_WORKERS || taskQueue.length === 0) return;
    const { directory, fileList } = taskQueue.shift();
    const availableWorker = workers.find((w) => w.idle);
    if (availableWorker) {
      availableWorker.idle = false;
      activateWorkers++;
      progressText.innerText = `Parsing ${done} / ${total} folder ...`;
      availableWorker.postMessage({ directory, fileList });
    }
  };
  for (const directory in fileGroupedByFolder) {
    addTask(directory, fileGroupedByFolder[directory]);
  }
});
dropZone.addEventListener("dragover", (event) => {
  event.preventDefault();
  dropZone.classList.add("dragover");
});
dropZone.addEventListener("dragleave", () => {
  dropZone.classList.remove("dragover");
});
searchForm.addEventListener("submit", (ev) => {
  ev.preventDefault();
  const mapName = document.getElementById("map-name").value;
  const minTime = parseFloat(document.getElementById("min-time").value);
  const maxTime = parseFloat(document.getElementById("max-time").value);
  const minTicks = minTime * 60 - 1;
  const maxTicks = maxTime * 60 + 1;
  const filteredData = {};
  for (const folder in fileGroupedByFolder) {
    if (fileGroupedByFolder.hasOwnProperty(folder)) {
      const folderData = fileGroupedByFolder[folder];
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
copyButton.addEventListener("click", () => {
  outputText.select();
  document.execCommand("copy");
  alert("Copied to clipboard!");
});
downloadButton.addEventListener("click", () => {
  downloadJSON(outputText.value, "output.json");
});
downloadFullButton.addEventListener("click", () => {
  const fullJSON = JSON.stringify(fileGroupedByFolder, null, 2);
  downloadJSON(fullJSON, "full_data.json");
});
window.onload = () => {
  outputText.value = "";
};
async function handleDirectoryEntry(entry, rootPath) {
  const reader = entry.createReader();
  const readEntries = async () => {
    return new Promise((resolve, reject) => {
      reader.readEntries((entries2) => {
        if (entries2) resolve(entries2);
        else reject(new Error("Failed to read entries"));
      });
    });
  };
  let entries = await readEntries();
  let tasks = [];
  for (const subEntry of entries) {
    if (subEntry.isFile) {
      tasks.push(handleFileEntry(subEntry, rootPath));
    } else if (subEntry.isDirectory) {
      tasks.push(handleDirectoryEntry(subEntry, rootPath + subEntry.name + "/"));
    }
  }
  await Promise.all(tasks);
}
async function handleFileEntry(entry, rootPath) {
  const processFile = (file, path) => {
    if (!file.name.endsWith(".dem") && !file.name.endsWith(".DEM")) {
      console.log(`${file.name} not end with .dem, skipped.`);
      return;
    }
    if (!fileGroupedByFolder[path]) {
      fileGroupedByFolder[path] = [];
    }
    fileGroupedByFolder[path].push({
      file,
      sarSplits: void 0,
      mapName: "unknown",
      playbackTicks: void 0,
      player: "unknown",
      parsed: false
    });
  };
  return new Promise((resolve, reject) => {
    entry.file(
      (file) => {
        processFile(file, rootPath);
        resolve();
      },
      (error) => {
        reject(error);
      }
    );
  });
}
function downloadJSON(json, filename) {
  const blob = new Blob([json], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
