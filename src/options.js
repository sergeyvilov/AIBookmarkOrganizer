import * as io from './io.js';
import * as cluster from './clustering.js';

const apiKeyInput = document.getElementById("api-key");
const gptModelInput = document.getElementById("gpt-model");
const embedModelInput = document.getElementById("embed-model");
const systemPromptInput = document.getElementById("system-prompt");
const organizeBtn = document.getElementById("organize-btn");
const progressBar = document.getElementById("progress-bar");
const progressText = document.getElementById("progress-text");
const progressRow = document.getElementById("progress-row");

function getSettings() {
  return new Promise((resolve) => {
    chrome.storage.local.get(
      ['openAI_api_key', 'gpt_model', 'embed_model', 'gpt_system_prompt'],
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
  systemPromptInput.value = options.gpt_system_prompt || "";
}

// Save options
async function saveOptions() {
  await chrome.storage.local.set({
    openAI_api_key: apiKeyInput.value,
    gpt_model: gptModelInput.value,
    embed_model: embedModelInput.value,
    gpt_system_prompt: systemPromptInput.value
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

function updateProgress(processed, total) {
  if (processed === 0) {
    startTime = Date.now(); // Initialize start time
  }

  if (total === -1) {
    progressBar.style.width = `0%`;
    progressText.textContent = `0/-`;
  } else {
    const percent = total > 0 ? (processed / total) * 100 : 0;
    progressBar.style.width = `${percent}%`;

    let remainingText = "";

    if (startTime && processed > 0) {
      const elapsedMs = Date.now() - startTime;
      const averagePerItemMs = elapsedMs / processed;
      const remainingItems = total - processed;
      const estimatedRemainingMs = remainingItems * averagePerItemMs;

      remainingText = ` (~${formatTime(estimatedRemainingMs)} left)`;
    }

    progressText.textContent = `${processed}/${total}${remainingText}`;
  }
}

// Helper: Get summary and title from OpenAI
async function getSummaryAndTitle(url, fallbackTitle) {

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
    return { summary: fallbackTitle, title: fallbackTitle };
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
          content: gpt_system_prompt
        },
        {
          role: "user",
          content: `Please generate a summary and a title for the following webpage:\n\nURL: ${url}\n\nFormat your output as:\nsummary: <your_summary>\ntitle: <your_title>`
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
  const output = result.choices?.[0]?.message?.content || "";
  console.log("GPT output:", output);
  const summary = output.match(/summary:\s*(.+)/i)?.[1]?.trim();
  const title = output.match(/title:\s*(.+)/i)?.[1]?.trim();
  if (!summary || !title) {
    console.warn(`[getSummaryAndTitle] Incomplete GPT output, falling back to bookmark title: ${fallbackTitle}`);
    return { summary: fallbackTitle, title: fallbackTitle };
  }
  return { summary, title };
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

let openAI_api_key, gpt_model, embed_model, gpt_system_prompt

let cancelRequested = false;
let isOrganizing = false;

// Main function
async function organizeBookmarks(organizedFolder) {

  const settings = await getSettings();

  openAI_api_key = settings.openAI_api_key;
  gpt_model = settings.gpt_model;
  embed_model = settings.embed_model;
  gpt_system_prompt = settings.gpt_system_prompt;

  const unreachableBookmarks = [];

  console.log("[organizeBookmarks] Starting bookmark organization...");

  let bookmarks = await io.getAllBookmarks();

  bookmarks = bookmarks.slice(0, 10);

  console.log(`[organizeBookmarks] Total bookmarks found: ${bookmarks.length}`);

  const processed = [];

  updateProgress(0,bookmarks.length)

  for (const [bm_idx, bm] of bookmarks.entries()) {
    console.log(`[organizeBookmarks] Processing: ${bm.url}`);

    try {
      const result = await getSummaryAndTitle(bm.url, bm.title);
      if (!result) {
        console.log(`[organizeBookmarks] Unreachable: ${bm.url}`);
        unreachableBookmarks.push(bm);
        continue;
      }

      const { summary, title } = result;
      console.log(`[organizeBookmarks] Summary: ${summary}`);
      console.log(`[organizeBookmarks] Title: ${title}`);

      const embedding = await getEmbedding(summary, openAI_api_key,embed_model);
      if (!embedding) {
        console.warn(`[organizeBookmarks] Embedding failed for: ${bm.url}`);
        continue;
      }

      processed.push({ url: bm.url, title, summary, embedding });
    } catch (err) {
      console.error(`[organizeBookmarks] Error processing ${bm.url}:`, err);
      throw new Error(err)
    }

    if (cancelRequested) {
      console.log("[organizeBookmarks] Cancel requested. Stopping.");
      return;
    }

    updateProgress(bm_idx+1, bookmarks.length)

  }

  //const processed = await io.loadProcessedFromFile('processed_bookmarks.json');

  io.saveProcessedToFile(processed)

  console.log(`[organizeBookmarks] Finished processing. Total summarized: ${processed.length}`);

  // Create nested folders
  //const dendrogram = buildDendrogram(processed);

  //for (let t = 0.10; t <= 0.95; t += 0.01) {
  //  const clusters = cutDendrogram(dendrogram, t);
  //  console.log(`Threshold: ${t.toFixed(2)} → Clusters: ${clusters.length}`);
  //}

  //const { threshold, bestClusters } = findOptimalThreshold(dendrogram);

  //console.log(`Optimal threshold: ${threshold.toFixed(2)} | silhouetteScore: ${silhouetteScore(bestClusters).toFixed(3)}`);

  //const clusters = cutDendrogram(dendrogram, threshold); // threshold to cut tree

  const clusters = await cluster.generateDBSCANClusters(processed);

  console.log(`[organizeBookmarks] Clusters formed: ${clusters.length}`);

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
    const organizedFolder = await io.getOrganizedFolder()
    const bookmarks = await io.getAllBookmarks()
    const userConfirmed = confirm(`Found ${bookmarks.length} bookmarks. Start organizing?`);
    if (!userConfirmed) {
      return;
    }
    (async () => {
      try {
        isOrganizing = true;
        organizeBtn.textContent = "Cancel";
        progressRow.style.display = 'flex';
        await organizeBookmarks(organizedFolder);
        if (!cancelRequested) {
          console.log("Organizing done.");
          showToast(`Successfully organized ${bookmarks.length} bookmarks.`,'success');
          chrome.runtime.openOptionsPage();
        }
      } catch (err) {
        console.error("Organizing failed:", err);
        showToast(err.toString() + '. Please check the OpenAI API key and the model names.','error');
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
  systemPromptInput.style.height = calcHeight(systemPromptInput.value) + "px";

  [apiKeyInput, gptModelInput, embedModelInput, systemPromptInput].forEach(input => {
    input.addEventListener('input', () => {
      saveOptions();
    });
  });

});

function showToast(message, type = 'success') {
  const toast = document.getElementById('toast');
  toast.textContent = message;
  toast.style.backgroundColor = type === 'error' ? 'rgba(255, 0, 0, 0.8)' : 'rgba(0, 128, 0, 0.8)';
  toast.style.display = 'block';

  const hideToast = () => {
    toast.style.display = 'none';
    document.removeEventListener('click', hideToast);
  };

  document.addEventListener('click', hideToast);
}

function calcHeight(value) {
  let numberOfLineBreaks = (value.match(/\n/g) || []).length;
  // min-height + lines x line-height + padding + border
  let newHeight = 20 + numberOfLineBreaks * 20 + 12 + 2;
  return newHeight;
}

systemPromptInput.addEventListener("input", function() {
  systemPromptInput.style.height = calcHeight(systemPromptInput.value) + "px";
});

window.addEventListener('beforeunload', (event) => {
  if (isOrganizing) {
      event.preventDefault(); // Prevent the page from being unloaded
    }

});
