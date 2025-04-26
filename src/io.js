export async function getOrganizedFolder() {

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
export async function getAllBookmarks() {
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


export async function saveProcessedInChunks(processed) {
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
    a.download = `processed_bookmarks_part${i + 1}.json`;

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

export async function loadProcessedFromFile(filePath) {
  const response = await fetch(filePath);
  if (!response.ok) throw new Error(`Failed to load ${filePath}: ${response.statusText}`);
  const json = await response.json();
  return json;
}
