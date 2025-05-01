import * as io from './io.js';
import * as cluster from './clustering.js';

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
    //console.log(`[getSummaryAndTitle] URL ${url} has extension .${extension}, skipping fetch and using fallback.`);
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
  //console.log("GPT output:", summary);
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

  //console.log("[addUnreachableBookmarks] 'Organized Bookmarks' folder:", organizedFolder);

  // Create the "Unreachable" subfolder under "Organized Bookmarks"
  const organizedFolderChildren = await chrome.bookmarks.getChildren(organizedFolder.id);
  const unreachableFolderExisting = organizedFolderChildren.find(child => child.title === "Unreachable");

  const unreachableFolder = unreachableFolderExisting
  ? unreachableFolderExisting
  : (await chrome.bookmarks.create({ parentId: organizedFolder.id, title: "Unreachable" }));

  //console.log("[addUnreachableBookmarks] Created 'Unreachable' folder:", unreachableFolder);

  // Add all unreachable bookmarks to this folder
  for (const bm of bookmarks) {
    await chrome.bookmarks.create({ parentId: unreachableFolder.id, title: bm.title, url: bm.url });
  }

  //console.log(`[addUnreachableBookmarks] Added ${bookmarks.length} unreachable bookmarks.`);
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

  //console.log("[organizeBookmarks] Starting bookmark organization...");

  let bookmarks = await io.getAllBookmarks();

  //bookmarks = bookmarks.slice(0, 10);

  //console.log(`[organizeBookmarks] Total bookmarks found: ${bookmarks.length}`);

  const processed = [];

  updateProgress(0,bookmarks.length)

  for (const [bm_idx, bm] of bookmarks.entries()) {
    //console.log(`[organizeBookmarks] Processing: ${bm.url}`);

    try {
      const summary = await getSummary(bm.url, bm.title);
      if (!summary) {
        //console.log(`[organizeBookmarks] Unreachable: ${bm.url}`);
        unreachableBookmarks.push(bm);
        continue;
      }

      const title = bm.title;

      const embedding = await getEmbedding(summary);
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
      //console.log("[organizeBookmarks] Cancel requested. Stopping.");
      return;
    }

    updateProgress(bm_idx+1, bookmarks.length)

  }

  // io.saveProcessedInChunks(processed)

  // const processed = await io.loadAllProcessedFromFolder();

  //console.log(`[organizeBookmarks] Finished processing. Total summarized: ${processed.length}`);

  progressAction.textContent = 'Generating clusters... (2/3)'

  //const clusters = await cluster.generateHierarchicalClusters(processed);

  const clusters = await cluster.generateHierarchicalClusters(processed, (current, total) => {
    updateProgress(current, total, true);
    return cancelRequested;
    });

  if (clusters === -1) {
    console.warn(`[organizeBookmarks] clustering cancelled`);
    return;
  }

  //const clusters = await cluster.generateDBSCANClusters(processed);

  //console.log(`[organizeBookmarks] Clusters formed: ${clusters.length}`);

  //console.log(clusters)

  organizeBtn.disabled = true;

  progressAction.textContent = 'Creating folders... (3/3)'

  await createOrganizedFolders(clusters,organizedFolder);

  await addUnreachableBookmarks(unreachableBookmarks,organizedFolder);

  //console.log("[organizeBookmarks] Bookmark organization complete.");

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
    //console.log("Organize button clicked");
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
        progressAction.textContent = 'Getting page embeddings... (1/3)'
        progressRow.style.display = 'block';
        await organizeBookmarks(organizedFolder);
        if (!cancelRequested) {
          //console.log("Organizing done.");
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
