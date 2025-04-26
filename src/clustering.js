import { PCA } from 'ml-pca';
import { DBSCAN } from 'density-clustering';

function assignUniqueLabelsToNoise(clusters, totalPoints) {
  // Step 1: Create flatLabels and assign cluster labels
  const flatLabels = Array(totalPoints).fill(-1);
  clusters.forEach((indices, clusterId) => {
    indices.forEach(i => {
      flatLabels[i] = clusterId;
    });
  });

  // Step 2: Assign unique labels to noise points (-1)
  const noiseIndices = flatLabels
  .map((label, i) => label === -1 ? i : -1)
  .filter(i => i !== -1);

  const nextLabel = Math.max(...flatLabels) + 1;
  noiseIndices.forEach((i, offset) => {
    flatLabels[i] = nextLabel + offset;
  });

  return flatLabels;
}

export function generateDBSCANClusters(processedData, minPoints = 4) {
  const embeddings = processedData.map(item => item.embedding);
  const n = processedData.length;

  console.log(`Embeddings dimensions: ${embeddings[0].length} (assuming all embeddings have the same dimension)`);

  // 1. PCA
  const pca = new PCA(embeddings);
  const explainedVariance = pca.getExplainedVariance();

  let p2 = 0, cumulative = 0;
  for (; p2 < explainedVariance.length; p2++) {
    cumulative += explainedVariance[p2];
    if (cumulative >= 0.9) break;
  }

  const p1 = Math.floor(n / 5);
  const componentsToKeep = Math.min(p1, p2 + 1);
  const reduced = pca.predict(embeddings, { nComponents: componentsToKeep }).to2DArray();

  console.log(`p1 (min processedData length / 5): ${p1}`);
  console.log(`p2 (min number of components for PCA): ${p2}`);

  // 2. Silhouette-based epsilon search
  let bestEps = 0.02;
  let bestScore = -Infinity;

  for (let eps = 0.02; eps <= 1.0; eps += 0.02) {
    const dbscan = new DBSCAN();
    const clusters = dbscan.run(reduced, eps, minPoints);

    const flatLabels = assignUniqueLabelsToNoise(clusters, reduced.length);
    const score = silhouetteScore(reduced, flatLabels);

    console.log(`Silhouette score for epsilon ${eps.toFixed(3)}: ${score.toFixed(3)}`);

    if (score > bestScore) {
      bestScore = score;
      bestEps = eps;
    }
  }

  // 3. Final DBSCAN with best epsilon
  const dbscan = new DBSCAN();
  const finalClusters = dbscan.run(reduced, bestEps, minPoints);
  const finalLabels = assignUniqueLabelsToNoise(finalClusters, reduced.length);

  // Convert flatLabels into clusters
  const clusters = [];
  finalLabels.forEach((label, i) => {
    if (!clusters[label]) {
      clusters[label] = [];
    }
    clusters[label].push(processedData[i]);
  });

  return clusters;

}

function silhouetteScore(reduced, flatLabels) {
  const n = reduced.length;
  let totalScore = 0;

  for (let i = 0; i < n; i++) {
    const label = flatLabels[i];

    const ownClusterPoints = reduced.filter((_, idx) => flatLabels[idx] === label);
    if (ownClusterPoints.length <= 1) {
      totalScore += 0; // silhouette score is 0 for single-point clusters
      continue;
    }

    const otherClusterPoints = reduced.filter((_, idx) => flatLabels[idx] !== label);

    const a = computeAverageDistance(reduced[i], ownClusterPoints);
    const b = computeAverageDistance(reduced[i], otherClusterPoints);

    const score = (b - a) / Math.max(a, b);
    totalScore += score;
  }

  return totalScore / n;
}


function computeAverageDistance(point, clusterPoints) {
  const distances = clusterPoints.map(clusterPoint => euclideanDistance(point, clusterPoint));
  const averageDistance = distances.reduce((sum, dist) => sum + dist, 0) / distances.length;
  return averageDistance;
}

// Euclidean distance function
function euclideanDistance(A, B) {
  const squaredDiffs = A.map((a, idx) => Math.pow(a - B[idx], 2));
  return Math.sqrt(squaredDiffs.reduce((sum, diff) => sum + diff, 0));
}
