# 🌟 AI Bookmark Organizer

**A Firefox extension that uses AI to organize your bookmarks automatically.**

---

## ✨ Features

- 🔑 **Requires an OpenAI API key** to run.
- 📚 **Organizes only** the bookmarks from the **Other Bookmarks** folder.
- 🗂️ **Creates cluster folders** inside a new **Organized Bookmarks** folder.
- 🚫 **Unreachable pages** are collected under **Organized Bookmarks/Unreachable**.
- 📝 **Bookmarks may be renamed** if their current titles don't accurately reflect the page content (see *How It Works* below).

---

## ⚙️ How It Works

1. 📖 For each bookmarked page:
   - A **short title** and a **500-word summary** are extracted using an OpenAI GPT model (e.g., `gpt-4o-mini`).
   - If the current title doesn't match the page content, a **new, more descriptive title** is generated based on the page content and a web search.

2. 🧐 For each summary **embeddings** are generated using an OpenAI model (e.g., `text-embedding-3-large`).

3. 🔍 **DBSCAN clustering** (with `minPoints = 4`) is applied to the embeddings to group similar bookmarks.

4. 📈 The **optimal number of clusters** is determined by maximizing the **Silhouette score** over a range of DBSCAN `epsilon` values.

5. 🏷️ For each cluster a **cluster name** is generated using a GPT model, based on the combined summaries of the pages in that cluster.

6. 🚀 Pages classified as **noise** by DBSCAN are treated as **isolated clusters**.
