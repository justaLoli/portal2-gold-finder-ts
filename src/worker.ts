import { SourceDemo, SourceDemoParser} from "@nekz/sdp";
import { SarTimer, SourceTimer } from "@nekz/sdp/speedrun";
import { DemoFile, GroupedDemo } from "./defs";

self.addEventListener("message", async (event) => {
	const { directory, fileList } = event.data;
	try{
		await parseListFiles(fileList);
		const groupedFiles = groupFilesByMapName(fileList);
		self.postMessage({ directory: directory, result: groupedFiles });
	} catch (error) {
		self.postMessage({ error });
	}
});

/*闭包封装的tryParseDemo，让使用的变量只创建一次的同时，不污染全局变量
这是一个JS特性，和TS无关，但还是很有趣。*/
const __tryParseDemo = () => {
	// Parse and Split and Timing
	const parser = SourceDemoParser.default();
	const speedrunTimer = SourceTimer.default();
	const sarTimer = SarTimer.default();
	/*摆烂的时候可以用any*/
	return (ev:any, fullAdjustment = true) => {
		let demo:SourceDemo | null = null;
	    try {
	        demo = parser.parse(ev.target.result);
	        /*这里（下面）竟然不需要加"!"?*/
	        // Fix message ticks
	        demo.detectGame().adjustTicks();       
	        if (fullAdjustment) {
	            // Fix header
	            demo.adjustRange();
	            // Adjust 0-tick demos manually
	            if (demo.playbackTicks === 0) {
	                const ipt = demo.getIntervalPerTick();
	                demo.playbackTicks = 1;
	                demo.playbackTime = ipt;
	            } else {
	            	/*demo.speedrun和demo.sar其实是这里才添加的。而我的后续代码都没有用到这两个属性。
	            	因此我们只执行time（以防它对demo其它属性有修改）但不保存它们*/                
	                // Speedrun rules apply here
	                speedrunTimer.time(demo);
	                // Check SAR support
	                sarTimer.time(demo);
	            }
	        }
	    } catch (error) {
	        console.error(error);
	    }
	    return demo;
	};
}
const tryParseDemo = __tryParseDemo();

const parseListFiles = async (fileList: DemoFile[]) => {
	const parseFile = async (file: DemoFile) => {
	    if (file.parsed) return; // 如果已经解析过，直接返回
	    return new Promise<void>( (resolve, reject) => {
	        const reader = new FileReader();
	        reader.onload = (ev) => {
	            try {
	                const demo = tryParseDemo(ev);
	                if (demo != null) {
	                    file.mapName = demo.mapName ?? "unknown";
	                    file.playbackTicks = demo.playbackTicks;
	                    file.player = demo.clientName ?? "unknown";
	                    file.parsed = true;
	                }
	                resolve();
	            } catch (error) {
	                reject(error); // 捕获并抛出错误
	            }
	        };
	        reader.onerror = () => {
	            reject(new Error(`Failed to read file: ${file.file.name}`));
	        };
	        reader.readAsArrayBuffer(file.file);
	    });
	};
	/*用Promise.all的方法更好处理异步逻辑*/
	if (fileList.length === 0) return;
	try {
		await Promise.all(fileList.map(parseFile));
	} catch (error) {
		console.error(error);
	}
};

const groupFilesByMapName = (fileList: DemoFile[]) => {
	const groupedFiles: GroupedDemo = {};
	fileList.forEach( file => {
		if (!groupedFiles[file.mapName]) {
			groupedFiles[file.mapName] = { files: [], sumTick: 0 };
		}
		const group = groupedFiles[file.mapName];
		group.files.push({
			fileName: file.file.name,
			playbackTicks: file.playbackTicks 
		});
		group.sumTick += file.playbackTicks ?? 0;
	});
	return groupedFiles;
};