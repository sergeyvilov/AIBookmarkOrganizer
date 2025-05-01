/******/ (() => { // webpackBootstrap
/******/ 	"use strict";
/******/ 	var __webpack_modules__ = ({

/***/ "./src/clustering.js":
/*!***************************!*\
  !*** ./src/clustering.js ***!
  \***************************/
/***/ ((__unused_webpack_module, __webpack_exports__, __webpack_require__) => {

__webpack_require__.r(__webpack_exports__);
/* harmony export */ __webpack_require__.d(__webpack_exports__, {
/* harmony export */   generateHierarchicalClusters: () => (/* binding */ generateHierarchicalClusters)
/* harmony export */ });
async function generateHierarchicalClusters(processed, onProgress = null) {

  const dendrogram = await buildDendrogram(processed, onProgress);

  // for (let t = 0.10; t <= 0.95; t += 0.01) {
  //   const clusters = cutDendrogram(dendrogram, t);
  //   console.log(`Threshold: ${t.toFixed(2)} → Clusters: ${clusters.length}`);
  // }

  if (dendrogram === -1) {
    return -1;
  }

  const { threshold, bestClusters } = findOptimalThreshold(dendrogram);

  const clusters = cutDendrogram(dendrogram, threshold); // threshold to cut tree

  clusters.sort((a, b) => b.length - a.length);

  return clusters

}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function buildDendrogram(items,onProgress = null) {

  const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

  items.forEach((item, idx) => {
    item.id = idx;
  });

  let nodes = items.map((item, idx) => ({
    item,
    id: idx,
    items: [item]
  }));

  const totalMerges = items.length - 1;

  if (onProgress) {
    onProgress(0, totalMerges);
  }

  await sleep(0);  // 0ms still yields to the event loop

  let nextClusterId = items.length;

  // Precompute and cache all pairwise cosine similarities between initial items
  const similarityCache = new Map();
  for (let i = 0; i < items.length; i++) {
    for (let j = i + 1; j < items.length; j++) {
      const sim = cosineSim(items[i].embedding, items[j].embedding);
      similarityCache.set(pairKey(i, j), sim);
    }
  }

  // Helper to create a consistent key for a pair of cluster IDs
  function pairKey(i, j) {
    return i < j ? `${i}_${j}` : `${j}_${i}`;
  }

  // Compute average linkage similarity with caching
  function averageLinkage(clusterA, clusterB) {
    let totalSim = 0;
    let count = 0;

    for (const a of clusterA.items) {
      for (const b of clusterB.items) {
        const i = a.id;
        const j = b.id;
        const key = pairKey(i, j);
        if (!similarityCache.has(key)) {
          similarityCache.set(key, cosineSim(a.embedding, b.embedding));
        }
        totalSim += similarityCache.get(key);
        count++;
      }
    }

    return totalSim / count;
  }

  // Main loop to build dendrogram
  while (nodes.length > 1) {
    let maxSim = -Infinity;
    let bestPair = [0, 1];

    for (let i = 0; i < nodes.length; i++) {
      for (let j = i + 1; j < nodes.length; j++) {
        const sim = averageLinkage(nodes[i], nodes[j]);
        if (sim > maxSim) {
          maxSim = sim;
          bestPair = [i, j];
        }
      }
    }

    const [i, j] = bestPair;
    const clusterA = nodes[i];
    const clusterB = nodes[j];

    const merged = {
      id: nextClusterId++,
      left: clusterA,
      right: clusterB,
      similarity: maxSim,
      items: [...clusterA.items, ...clusterB.items]
    };

    console.log(`Merging clusters ${clusterA.id} & ${clusterB.id} | Max similarity: ${maxSim.toFixed(4)}`);

    // Safely remove clusters in reverse order to prevent index shift
    const [first, second] = [i, j].sort((a, b) => b - a);
    nodes.splice(first, 1);
    nodes.splice(second, 1);
    nodes.push(merged);

    const processed = totalMerges - (nodes.length - 1);

    if (onProgress) {
      const cancelRequested = onProgress(processed, totalMerges);
      if (cancelRequested) {
          console.log("[clustering] Cancel requested. Stopping.");
          return -1;
      }
    }

    if (processed % 10 === 0) {
      await sleep(0);  // 0ms still yields to the event loop
    }

  }

  return nodes[0]; // Return the dendrogram root
}

// Cosine similarity function
function cosineSim(a, b) {
  const dot = a.reduce((sum, val, i) => sum + val * b[i], 0);
  const magA = Math.sqrt(a.reduce((sum, val) => sum + val * val, 0));
  const magB = Math.sqrt(b.reduce((sum, val) => sum + val * val, 0));
  return dot / (magA * magB);
}

// Cut dendrogram at threshold to get flat clusters
function cutDendrogram(node, threshold) {
  if (!node.left || !node.right) {
    // Leaf node, return single item cluster
    return [[node.item]];
  }

  if (node.similarity >= threshold) {
    // Merge acceptable, return as one cluster
    return [collectItems(node)];
  }

  // Split into smaller clusters
  return [
    ...cutDendrogram(node.left, threshold),
    ...cutDendrogram(node.right, threshold)
  ];
}


function collectItems(node) {
  if (node.item) return [node.item];
  return [...collectItems(node.left), ...collectItems(node.right)];
}

function findOptimalThreshold(dendrogram, {
  initialSteps = 10,
  refinementSteps = 10,
  maxRefinements = 3,
  zoomFraction = 0.25
} = {}) {
  // Helper to collect similarity thresholds from dendrogram
  function getAllThresholds(node, thresholds = []) {
    if (!node.left || !node.right) return thresholds;
    thresholds.push(node.similarity);
    getAllThresholds(node.left, thresholds);
    getAllThresholds(node.right, thresholds);
    return thresholds;
  }

  // Normalize values to [0, 1]
  function normalize(array) {
    const min = array[0], max = array[array.length - 1];
    return array.map(v => (v - min) / (max - min));
  }

  // Elbow detection via maximum perpendicular distance
  function elbowIndex(thresholds, numClusters) {
    const normX = normalize(thresholds);
    const normY = normalize(numClusters.map(c => numClusters[0] - c)); // inverted

    const start = [normX[0], normY[0]];
    const end = [normX[normX.length - 1], normY[normY.length - 1]];
    const lineVec = [end[0] - start[0], end[1] - start[1]];
    const lineLen = Math.hypot(lineVec[0], lineVec[1]);

    let maxDist = -Infinity;
    let maxIdx = 0;

    for (let i = 0; i < normX.length; i++) {
      const px = normX[i], py = normY[i];
      const vecToPoint = [px - start[0], py - start[1]];
      const cross = Math.abs(lineVec[0] * vecToPoint[1] - lineVec[1] * vecToPoint[0]);
      const dist = cross / lineLen;
      if (dist > maxDist) {
        maxDist = dist;
        maxIdx = i;
      }
    }

    return maxIdx;
  }

  // Gather all similarity thresholds and determine range
  const allThresholds = getAllThresholds(dendrogram).sort((a, b) => a - b);
  let low = allThresholds[0];
  let high = allThresholds[allThresholds.length - 1];

  let threshold = low;
  let bestClusters = [];

  for (let r = 0; r < maxRefinements; r++) {
    const steps = r === 0 ? initialSteps : refinementSteps;
    const thresholds = Array.from({ length: steps }, (_, i) =>
    low + (i / (steps - 1)) * (high - low)
  );

  const clusterCounts = thresholds.map(t =>
    cutDendrogram(dendrogram, t).length
  );

  const idx = elbowIndex(thresholds, clusterCounts);
  threshold = thresholds[idx];
  bestClusters = cutDendrogram(dendrogram, threshold);

  console.log(`Optimal threshold after ${r} refinements: ${threshold.toFixed(2)}`);

  const delta = (thresholds[1] - thresholds[0]) * (refinementSteps / 2) * zoomFraction;
  low = Math.max(low, threshold - delta);
  high = Math.min(high, threshold + delta);
}

return { threshold, bestClusters };
}

// import { PCA } from 'ml-pca';
// import { DBSCAN } from 'density-clustering';
//
// function assignUniqueLabelsToNoise(clusters, totalPoints) {
//   // Step 1: Create flatLabels and assign cluster labels
//   const flatLabels = Array(totalPoints).fill(-1);
//   clusters.forEach((indices, clusterId) => {
//     indices.forEach(i => {
//       flatLabels[i] = clusterId;
//     });
//   });
//
//   // Step 2: Assign unique labels to noise points (-1)
//   const noiseIndices = flatLabels
//   .map((label, i) => label === -1 ? i : -1)
//   .filter(i => i !== -1);
//
//   const nextLabel = Math.max(...flatLabels) + 1;
//   noiseIndices.forEach((i, offset) => {
//     flatLabels[i] = nextLabel + offset;
//   });
//
//   return flatLabels;
// }
//
// export function generateDBSCANClusters(processedData, minPoints = 4) {
//   const embeddings = processedData.map(item => item.embedding);
//   const n = processedData.length;
//
//   console.log(`Embeddings dimensions: ${embeddings[0].length} (assuming all embeddings have the same dimension)`);
//
//   // 1. PCA
//   const pca = new PCA(embeddings);
//   const explainedVariance = pca.getExplainedVariance();
//
//   let p2 = 0, cumulative = 0;
//   for (; p2 < explainedVariance.length; p2++) {
//     cumulative += explainedVariance[p2];
//     if (cumulative >= 0.9) break;
//   }
//
//   const p1 = Math.floor(n / 5);
//   const componentsToKeep = Math.min(p1, p2 + 1);
//   const reduced = pca.predict(embeddings, { nComponents: componentsToKeep }).to2DArray();
//
//   console.log(`p1 (min processedData length / 5): ${p1}`);
//   console.log(`p2 (min number of components for PCA): ${p2}`);
//
//   // 2. Silhouette-based epsilon search
//   let bestEps = 0.02;
//   let bestScore = -Infinity;
//
//   for (let eps = 0.02; eps <= 1.0; eps += 0.02) {
//     const dbscan = new DBSCAN();
//     const clusters = dbscan.run(reduced, eps, minPoints);
//
//     const flatLabels = assignUniqueLabelsToNoise(clusters, reduced.length);
//     const score = silhouetteScore(reduced, flatLabels);
//
//     console.log(`Silhouette score for epsilon ${eps.toFixed(3)}: ${score.toFixed(3)}`);
//
//     if (score > bestScore) {
//       bestScore = score;
//       bestEps = eps;
//     }
//   }
//
//   // 3. Final DBSCAN with best epsilon
//   const dbscan = new DBSCAN();
//   const finalClusters = dbscan.run(reduced, bestEps, minPoints);
//   const finalLabels = assignUniqueLabelsToNoise(finalClusters, reduced.length);
//
//   // Convert flatLabels into clusters
//   const clusters = [];
//   finalLabels.forEach((label, i) => {
//     if (!clusters[label]) {
//       clusters[label] = [];
//     }
//     clusters[label].push(processedData[i]);
//   });
//
//   return clusters;
//
// }
//
// function silhouetteScore(reduced, flatLabels) {
//   const n = reduced.length;
//   let totalScore = 0;
//
//   for (let i = 0; i < n; i++) {
//     const label = flatLabels[i];
//
//     const ownClusterPoints = reduced.filter((_, idx) => flatLabels[idx] === label);
//     if (ownClusterPoints.length <= 1) {
//       totalScore += 0; // silhouette score is 0 for single-point clusters
//       continue;
//     }
//
//     const otherClusterPoints = reduced.filter((_, idx) => flatLabels[idx] !== label);
//
//     const a = computeAverageDistance(reduced[i], ownClusterPoints);
//     const b = computeAverageDistance(reduced[i], otherClusterPoints);
//
//     const score = (b - a) / Math.max(a, b);
//     totalScore += score;
//   }
//
//   return totalScore / n;
// }
//
//
// function computeAverageDistance(point, clusterPoints) {
//   const distances = clusterPoints.map(clusterPoint => euclideanDistance(point, clusterPoint));
//   const averageDistance = distances.reduce((sum, dist) => sum + dist, 0) / distances.length;
//   return averageDistance;
// }
//
// // Euclidean distance function
// function euclideanDistance(A, B) {
//   const squaredDiffs = A.map((a, idx) => Math.pow(a - B[idx], 2));
//   return Math.sqrt(squaredDiffs.reduce((sum, diff) => sum + diff, 0));
// }


/***/ }),

/***/ "./src/io.js":
/*!*******************!*\
  !*** ./src/io.js ***!
  \*******************/
/***/ ((__unused_webpack_module, __webpack_exports__, __webpack_require__) => {

__webpack_require__.r(__webpack_exports__);
/* harmony export */ __webpack_require__.d(__webpack_exports__, {
/* harmony export */   getAllBookmarks: () => (/* binding */ getAllBookmarks),
/* harmony export */   getOrganizedFolder: () => (/* binding */ getOrganizedFolder),
/* harmony export */   loadAllProcessedFromFolder: () => (/* binding */ loadAllProcessedFromFolder),
/* harmony export */   saveProcessedInChunks: () => (/* binding */ saveProcessedInChunks)
/* harmony export */ });
async function getOrganizedFolder() {

  const root = await chrome.bookmarks.getTree();
  const bar = root[0].children.find(
    child => child.title === "Bookmarks Toolbar" || child.title === "Bookmarks Menu"
  ) || root[0];

  const barChildren = await chrome.bookmarks.getChildren(bar.id);
  const existing = barChildren.find(child => child.title === "Organized Bookmarks");

  console.log("existing", existing);

  let OrganizedFolder;

  if (existing) {

    console.log("waiting for confirmation");
    const userConfirmed = confirm('"Organized Bookmarks" folder already exists. Do you want to delete it and create a new one?');
    if (userConfirmed) {
      await chrome.bookmarks.removeTree(existing.id);
      OrganizedFolder = await chrome.bookmarks.create({ parentId: bar.id, title: "Organized Bookmarks" });
      console.log("Created new 'Organized Bookmarks' folder.");
    } else {
      OrganizedFolder = existing;
      console.log("'Organized Bookmarks' folder remains unchanged.");
    }
  } else {
    OrganizedFolder = await chrome.bookmarks.create({ parentId: bar.id, title: "Organized Bookmarks" });
    console.log("Created new 'Organized Bookmarks' folder.");
  }

  return OrganizedFolder
}

//2. The summary is a keyword list enumerating 10 generic topics related to the page content. Each keyword may consist of 1-4 individual words. Avoid mentioning concrete named entities in the summary.
// Recursively get all bookmarks, skipping 'Organized Bookmarks'
async function getAllBookmarks() {
  const tree = await chrome.bookmarks.getTree();
  const rootChildren = tree[0].children;

  const otherBookmarksNode = rootChildren.find(child => child.title === "Other Bookmarks");
  const bookmarks = [];

  if (!otherBookmarksNode || !otherBookmarksNode.children) {
    console.warn("'Other Bookmarks' folder not found or empty.");
    return bookmarks;
  }

  function traverse(nodes) {
    for (const node of nodes) {
      if (node.url) {
        bookmarks.push({ title: node.title, url: node.url });
      }
      if (node.children) {
        traverse(node.children);
      }
    }
  }

  traverse(otherBookmarksNode.children);
  console.log("Filtered bookmarks from 'Other Bookmarks':", bookmarks.length);
  return bookmarks;
}


async function saveProcessedInChunks(processed) {
  const chunkSize = 200;
  const totalChunks = Math.ceil(processed.length / chunkSize);

  for (let i = 0; i < totalChunks; i++) {
    const chunk = processed.slice(i * chunkSize, (i + 1) * chunkSize);
    const jsonString = JSON.stringify(chunk, null, 2);
    const blob = new Blob([jsonString], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");

    a.style.display = "none";
    a.href = url;
    a.download = `processed_bookmarks/processed_bookmarks_part${i + 1}.json`;

    document.body.appendChild(a);

    // Allow browser to process before triggering download
    await new Promise((resolve) => {
      requestAnimationFrame(() => {
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        resolve();
      });
    });
  }
}

async function loadAllProcessedFromFolder() {
  try {
    const merged = [];
    const filePromises = [];

    // 🚨 Fallback: <input type="file" webkitdirectory>
    const input = document.createElement('input');
    input.type = 'file';
    input.webkitdirectory = true;
    input.multiple = true;
    input.style.display = 'none';

    const fileSelection = new Promise((resolve) => {
      input.onchange = () => resolve(Array.from(input.files));
      document.body.appendChild(input);
      input.click();
    });

    const files = await fileSelection;
    document.body.removeChild(input);

    files
    .filter(file => file.name.endsWith('.json'))
    .forEach(file => {
      const filePromise = file.text().then(text => {
        try {
          const json = JSON.parse(text);
          if (Array.isArray(json)) return json;
          console.warn(`${file.name} did not contain a JSON array`);
          return [];
        } catch (err) {
          console.error(`Error parsing ${file.name}:`, err);
          return [];
        }
      });
      filePromises.push(filePromise);
    });


    const results = await Promise.all(filePromises);
    results.forEach(arr => merged.push(...arr));

    console.log(`Loaded ${merged.length} items from ${results.length} files.`);
    return merged;

  } catch (err) {
    console.error("Failed to load files:", err);
    throw err;
  }
}


/***/ })

/******/ 	});
/************************************************************************/
/******/ 	// The module cache
/******/ 	var __webpack_module_cache__ = {};
/******/ 	
/******/ 	// The require function
/******/ 	function __webpack_require__(moduleId) {
/******/ 		// Check if module is in cache
/******/ 		var cachedModule = __webpack_module_cache__[moduleId];
/******/ 		if (cachedModule !== undefined) {
/******/ 			return cachedModule.exports;
/******/ 		}
/******/ 		// Create a new module (and put it into the cache)
/******/ 		var module = __webpack_module_cache__[moduleId] = {
/******/ 			// no module.id needed
/******/ 			// no module.loaded needed
/******/ 			exports: {}
/******/ 		};
/******/ 	
/******/ 		// Execute the module function
/******/ 		__webpack_modules__[moduleId](module, module.exports, __webpack_require__);
/******/ 	
/******/ 		// Return the exports of the module
/******/ 		return module.exports;
/******/ 	}
/******/ 	
/************************************************************************/
/******/ 	/* webpack/runtime/define property getters */
/******/ 	(() => {
/******/ 		// define getter functions for harmony exports
/******/ 		__webpack_require__.d = (exports, definition) => {
/******/ 			for(var key in definition) {
/******/ 				if(__webpack_require__.o(definition, key) && !__webpack_require__.o(exports, key)) {
/******/ 					Object.defineProperty(exports, key, { enumerable: true, get: definition[key] });
/******/ 				}
/******/ 			}
/******/ 		};
/******/ 	})();
/******/ 	
/******/ 	/* webpack/runtime/hasOwnProperty shorthand */
/******/ 	(() => {
/******/ 		__webpack_require__.o = (obj, prop) => (Object.prototype.hasOwnProperty.call(obj, prop))
/******/ 	})();
/******/ 	
/******/ 	/* webpack/runtime/make namespace object */
/******/ 	(() => {
/******/ 		// define __esModule on exports
/******/ 		__webpack_require__.r = (exports) => {
/******/ 			if(typeof Symbol !== 'undefined' && Symbol.toStringTag) {
/******/ 				Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' });
/******/ 			}
/******/ 			Object.defineProperty(exports, '__esModule', { value: true });
/******/ 		};
/******/ 	})();
/******/ 	
/************************************************************************/
var __webpack_exports__ = {};
// This entry needs to be wrapped in an IIFE because it needs to be isolated against other modules in the chunk.
(() => {
/*!************************!*\
  !*** ./src/options.js ***!
  \************************/
__webpack_require__.r(__webpack_exports__);
/* harmony import */ var _io_js__WEBPACK_IMPORTED_MODULE_0__ = __webpack_require__(/*! ./io.js */ "./src/io.js");
/* harmony import */ var _clustering_js__WEBPACK_IMPORTED_MODULE_1__ = __webpack_require__(/*! ./clustering.js */ "./src/clustering.js");



const apiKeyInput = document.getElementById("api-key");
const gptModelInput = document.getElementById("gpt-model");
const embedModelInput = document.getElementById("embed-model");
const organizeBtn = document.getElementById("organize-btn");
const progressBar = document.getElementById("progress-bar");
const progressText = document.getElementById("progress-text");
const progressRow = document.getElementById("progress-row");
const progressAction = document.getElementById("progress-action");
const toggle = document.getElementById('toggle-advanced');
const advancedDiv = document.getElementById('advanced-settings');
const openAIErrors = document.getElementById('openai-errors');
const toastMsg = document.getElementById('toast-msg');
const toast = document.getElementById('toast');

function getSettings() {
  return new Promise((resolve) => {
    chrome.storage.local.get(
      ['openAI_api_key', 'gpt_model', 'embed_model'],
      (result) => {
        resolve(result);
      }
    );
  });
}

// Load stored options
async function loadOptions() {
  const options = await getSettings();
  apiKeyInput.value = options.openAI_api_key || "";
  gptModelInput.value = options.gpt_model || "";
  embedModelInput.value = options.embed_model || "";
}

// Save options
async function saveOptions() {
  await chrome.storage.local.set({
    openAI_api_key: apiKeyInput.value,
    gpt_model: gptModelInput.value,
    embed_model: embedModelInput.value,
  });
}

// Update progress UI
let startTime = null; // Save when the processing started

function formatTime(ms) {
  const totalSeconds = Math.round(ms / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  if (hours > 0) {
    return `${hours}h ${minutes}m`;
  } else if (minutes > 0) {
    return `${minutes}m ${seconds}s`;
  } else {
    return `${seconds}s`;
  }
}

function updateProgress(processed, total, pct = false) {
  if (processed === 0) {
    startTime = Date.now(); // Initialize start time
  }

  if (total === -1) {
    progressBar.style.width = `0%`;
    progressText.textContent = `0/-`;
  } else {
    const percent = total > 0 ? (processed / total) * 100 : 0;
    progressBar.style.width = `${percent}%`;

    let remainingText = " (unknown time left)";

    if (startTime && processed > 0) {
      const elapsedMs = Date.now() - startTime;
      const averagePerItemMs = elapsedMs / processed;
      const remainingItems = total - processed;
      const estimatedRemainingMs = remainingItems * averagePerItemMs;

      remainingText = ` (~${formatTime(estimatedRemainingMs)} left)`;
    }

    if (pct) {
      progressText.textContent = `${Math.round(percent)}%${remainingText}`;
    } else {
      progressText.textContent = `${processed}/${total}${remainingText}`;
    }

  }
}

async function getSummary(url, fallbackSummary) {

  try {
    if (!(await fetch(url, { method: 'HEAD' })).ok) return null; // Unreachable
  } catch (err) {
    return null;
  }

  const urlObj = new URL(url);
  const pathname = urlObj.pathname;
  const segments = pathname.split('.');
  const hasExtension = segments.length > 1;
  const extension = hasExtension ? segments.pop().toLowerCase() : null;

  if (hasExtension && extension !== 'html') {
    console.log(`[getSummaryAndTitle] URL ${url} has extension .${extension}, skipping fetch and using fallback.`);
    return fallbackSummary;
  }

  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${openAI_api_key}`
    },
    body: JSON.stringify({
      model: gpt_model,
      messages: [
        {
          role: "system",
          content: "You are a helpful assistant that summarizes webpages for bookmark organization. You provide a single-paragraph summary (~500 words) of a given webpage. Do not mention hosting platforms (e.g., YouTube, Medium, StackOverflow) in the summary or title. Do not use Markdown, HTML, or emojis in the summary or title. The last sentence should also mention areas of aplication of the information on the page. Output 'error' if you can not generate the summary"
        },
        {
          role: "user",
          content: `Please generate a summary for the following webpage:\n\nURL: ${url}`
        }
      ],
      temperature: 0.7
    })
  });
  if(response.status!==200)
  {
    throw new Error(response.status)
  }
  const result = await response.json();
  const summary = result.choices?.[0]?.message?.content.trim() || "";
  console.log("GPT output:", summary);
  if (summary === 'error') {
    return fallbackSummary
  }
  return summary
}

// Get OpenAI embeddings
async function getEmbedding(text) {
  const response = await fetch("https://api.openai.com/v1/embeddings", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${openAI_api_key}`
    },
    body: JSON.stringify({
      input: text,
      model: embed_model
    })
  });
  if(response.status!==200)
  {
    throw new Error(response.status)
  }
  const data = await response.json();
  return data.data?.[0]?.embedding ?? null;
}

// Generate cluster title with GPT
async function getClusterTitle(summaries) {
  try {
    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${openAI_api_key}`
      },
      body: JSON.stringify({
        model: gpt_model,
        messages: [
          {
            role: "system",
            content: `You are a helpful assistant that summarizes webpages for bookmark organization. You provide a meaningful, human-readable label (5–7 words) for a given set of summaries. Do **not** use any Markdown, HTML, emojis or qoutes.`
          },
          {
            role: "user",
            content: `Generate a label that best describes the following summaries:\n` + summaries.join("\n")
          }
        ],
        temperature: 0.7
      })
    });
    const result = await response.json();
    return result.choices[0].message.content.trim();
  } catch (err) {
    console.error("[Error] Failed to generate cluster title:", err);
    return "Untitled Cluster";
  }
}

// Create folders and add clustered bookmarks
async function createOrganizedFolders(clusters,organizedFolder) {

  const rootFolderId = organizedFolder.id

  for (const cluster of clusters) {
    if (cluster.length === 1) {
      // Single-page cluster: add bookmark directly to root folder
      const bm = cluster[0];
      await chrome.bookmarks.create({ parentId: rootFolderId, title: bm.title, url: bm.url });
    } else {
      // Multi-page cluster: create subfolder and populate
      const summaries = cluster.map(b => b.summary);
      const label = await getClusterTitle(summaries);
      const folder = await chrome.bookmarks.create({ parentId: rootFolderId, title: label });

      for (const bm of cluster) {
        await chrome.bookmarks.create({ parentId: folder.id, title: bm.title, url: bm.url });
      }
    }
  }
}

async function addUnreachableBookmarks(bookmarks,organizedFolder) {
  if (bookmarks.length === 0) return;

  console.log("[addUnreachableBookmarks] 'Organized Bookmarks' folder:", organizedFolder);

  // Create the "Unreachable" subfolder under "Organized Bookmarks"
  const organizedFolderChildren = await chrome.bookmarks.getChildren(organizedFolder.id);
  const unreachableFolderExisting = organizedFolderChildren.find(child => child.title === "Unreachable");

  const unreachableFolder = unreachableFolderExisting
  ? unreachableFolderExisting
  : (await chrome.bookmarks.create({ parentId: organizedFolder.id, title: "Unreachable" }));

  console.log("[addUnreachableBookmarks] Created 'Unreachable' folder:", unreachableFolder);

  // Add all unreachable bookmarks to this folder
  for (const bm of bookmarks) {
    await chrome.bookmarks.create({ parentId: unreachableFolder.id, title: bm.title, url: bm.url });
  }

  console.log(`[addUnreachableBookmarks] Added ${bookmarks.length} unreachable bookmarks.`);
}

let openAI_api_key, gpt_model, embed_model

let cancelRequested = false;
let isOrganizing = false;

// Main function
async function organizeBookmarks(organizedFolder) {

  const settings = await getSettings();

  openAI_api_key = settings.openAI_api_key;
  gpt_model = settings.gpt_model;
  embed_model = settings.embed_model;

  const unreachableBookmarks = [];

  console.log("[organizeBookmarks] Starting bookmark organization...");

  let bookmarks = await _io_js__WEBPACK_IMPORTED_MODULE_0__.getAllBookmarks();

  //bookmarks = bookmarks.slice(0, 10);

  console.log(`[organizeBookmarks] Total bookmarks found: ${bookmarks.length}`);
  // 
  // const processed = [];
  //
  // updateProgress(0,bookmarks.length)
  //
  // for (const [bm_idx, bm] of bookmarks.entries()) {
  //   console.log(`[organizeBookmarks] Processing: ${bm.url}`);
  //
  //   try {
  //     const summary = await getSummary(bm.url, bm.title);
  //     if (!summary) {
  //       console.log(`[organizeBookmarks] Unreachable: ${bm.url}`);
  //       unreachableBookmarks.push(bm);
  //       continue;
  //     }
  //
  //     const title = bm.title;
  //
  //     const embedding = await getEmbedding(summary);
  //     if (!embedding) {
  //       console.warn(`[organizeBookmarks] Embedding failed for: ${bm.url}`);
  //       continue;
  //     }
  //
  //     processed.push({ url: bm.url, title, summary, embedding });
  //   } catch (err) {
  //     console.error(`[organizeBookmarks] Error processing ${bm.url}:`, err);
  //     throw new Error(err)
  //   }
  //
  //   if (cancelRequested) {
  //     console.log("[organizeBookmarks] Cancel requested. Stopping.");
  //     return;
  //   }
  //
  //   updateProgress(bm_idx+1, bookmarks.length)
  //
  // }

  // io.saveProcessedInChunks(processed)

  const processed = await _io_js__WEBPACK_IMPORTED_MODULE_0__.loadAllProcessedFromFolder();

  console.log(`[organizeBookmarks] Finished processing. Total summarized: ${processed.length}`);

  progressAction.textContent = 'Generating clusters... (2/3)'

  //const clusters = await cluster.generateHierarchicalClusters(processed);

  const clusters = await _clustering_js__WEBPACK_IMPORTED_MODULE_1__.generateHierarchicalClusters(processed, (current, total) => {
    updateProgress(current, total, true);
    return cancelRequested;
    });

  if (clusters === -1) {
    console.warn(`[organizeBookmarks] clustering cancelled`);
    return;
  }

  //const clusters = await cluster.generateDBSCANClusters(processed);

  console.log(`[organizeBookmarks] Clusters formed: ${clusters.length}`);

  console.log(clusters)

  organizeBtn.disabled = true;

  progressAction.textContent = 'Creating folders... (3/3)'

  await createOrganizedFolders(clusters,organizedFolder);

  await addUnreachableBookmarks(unreachableBookmarks,organizedFolder);

  console.log("[organizeBookmarks] Bookmark organization complete.");

}

// Handle organize bookmarks button
organizeBtn.addEventListener("click", async () => {
  if (isOrganizing) {
    const userConfirmed = confirm('Do you want to interrupt bookmark organization?');
    if (userConfirmed) {
      cancelRequested = true;
      organizeBtn.disabled = true;
      organizeBtn.textContent = "Cancelling...";
    }
  } else {
    console.log("Organize button clicked");
    const organizedFolder = await _io_js__WEBPACK_IMPORTED_MODULE_0__.getOrganizedFolder()
    const bookmarks = await _io_js__WEBPACK_IMPORTED_MODULE_0__.getAllBookmarks()
    const userConfirmed = confirm(`Found ${bookmarks.length} bookmarks. Start organizing?`);
    if (!userConfirmed) {
      return;
    }
    (async () => {
      try {
        isOrganizing = true;
        organizeBtn.textContent = "Cancel";
        progressAction.textContent = 'Getting page embeddings... (1/3)'
        progressRow.style.display = 'block';
        await organizeBookmarks(organizedFolder);
        if (!cancelRequested) {
          console.log("Organizing done.");
          showToast(`Successfully organized ${bookmarks.length} bookmarks.`,'success');
          chrome.runtime.openOptionsPage();
        }
      } catch (err) {
        const msg = err.message;
        console.error('Error:' + msg);
        const pattern = /Error: (4|5)[0-9]{2}\b/;
        if (pattern.test(msg)) {
          openAIErrors.style.display = 'block';
          showToast(msg, 'error');
        } else {
          showToast('Error:' + msg,'error');
        }
      } finally {
        cancelRequested = false;
        isOrganizing = false;
        organizeBtn.disabled = false;
        organizeBtn.textContent = "Organize Bookmarks";
        progressRow.style.display = 'none';
        updateProgress(0,bookmarks.length)
      }
    })();
  }
});

document.addEventListener("DOMContentLoaded", async () => {
  await loadOptions();

  [apiKeyInput, gptModelInput, embedModelInput].forEach(input => {
    input.addEventListener('input', () => {
      saveOptions();
    });
  });

});

function showToast(message, type = 'success') {

  toastMsg.textContent = message;
  toast.style.backgroundColor = type === 'error' ? 'rgba(255, 0, 0, 0.8)' : 'rgba(0, 128, 0, 0.8)';
  toast.style.display = 'block';

  const hideToast = (event) => {
    // Only hide if the click is outside the toast
    if (!toast.contains(event.target)) {
      toast.style.display = 'none';
      openAIErrors.style.display = 'none';
      document.removeEventListener('click', hideToast);
    }
  };
  document.addEventListener('click', hideToast);
}


window.addEventListener('beforeunload', (event) => {
  if (isOrganizing) {
      event.preventDefault(); // Prevent the page from being unloaded
    }

});

toggle.addEventListener('change', () => {
  if (toggle.checked) {
    advancedDiv.style.maxHeight = "500px"; // Adjust if you have more content
    advancedDiv.style.opacity = "1";
  } else {
    advancedDiv.style.maxHeight = "0";
    advancedDiv.style.opacity = "0";
  }
});

})();

/******/ })()
;
//# sourceMappingURL=options.js.map