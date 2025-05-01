export async function generateHierarchicalClusters(processed, onProgress = null) {

  const dendrogram = await buildDendrogram(processed, onProgress);

  // for (let t = 0.10; t <= 0.95; t += 0.01) {
  //   const clusters = cutDendrogram(dendrogram, t);
  //   //console.log(`Threshold: ${t.toFixed(2)} → Clusters: ${clusters.length}`);
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

    //console.log(`Merging clusters ${clusterA.id} & ${clusterB.id} | Max similarity: ${maxSim.toFixed(4)}`);

    // Safely remove clusters in reverse order to prevent index shift
    const [first, second] = [i, j].sort((a, b) => b - a);
    nodes.splice(first, 1);
    nodes.splice(second, 1);
    nodes.push(merged);

    const processed = totalMerges - (nodes.length - 1);

    if (onProgress) {
      const cancelRequested = onProgress(processed, totalMerges);
      if (cancelRequested) {
          //console.log("[clustering] Cancel requested. Stopping.");
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

  //console.log(`Optimal threshold after ${r} refinements: ${threshold.toFixed(2)}`);

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
//   //console.log(`Embeddings dimensions: ${embeddings[0].length} (assuming all embeddings have the same dimension)`);
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
//   //console.log(`p1 (min processedData length / 5): ${p1}`);
//   //console.log(`p2 (min number of components for PCA): ${p2}`);
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
//     //console.log(`Silhouette score for epsilon ${eps.toFixed(3)}: ${score.toFixed(3)}`);
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
