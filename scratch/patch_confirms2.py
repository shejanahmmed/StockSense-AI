import re

with open('frontend/app.js', 'r', encoding='utf-8') as f:
    txt = f.read()

# Normalize line endings to \n for matching, restore after
txt_n = txt.replace('\r\n', '\n').replace('\r', '\n')

# ── 1. Delete SKU ──────────────────────────────────────────────────────────────
txt_n = txt_n.replace(
    "if (confirm(`Are you sure you want to delete SKU ${sku}?`)) {",
    "showConfirm(`Are you sure you want to delete SKU ${sku}?`, async () => {"
)

# ── 2. Clear chat history ───────────────────────────────────────────────────────
old2 = (
    "                const confirmed = confirm('Are you sure you want to clear your chat history? This cannot be undone.');\n"
    "                if (!confirmed) return;\n"
    "                await clearChatHistoryFrontend();"
)
new2 = (
    "                showConfirm('Clear your entire chat history? This cannot be undone.', async () => {\n"
    "                    await clearChatHistoryFrontend();\n"
    "                }, { title: 'Clear Chat History', variant: 'danger', confirmLabel: 'Clear All' });"
)
txt_n = txt_n.replace(old2, new2, 1)

# ── 3. Permanently delete chat ─────────────────────────────────────────────────
old3 = (
    "            row.querySelector('.perm-delete').addEventListener('click', () => {\n"
    "                if (!confirm('Permanently delete this chat? This cannot be undone.')) return;\n"
    "                let list = JSON.parse(localStorage.getItem('stockSense_deletedChats') || '[]');\n"
    "                list = list.filter(s => s.id !== sess.id);\n"
    "                localStorage.setItem('stockSense_deletedChats', JSON.stringify(list));\n"
    "                renderTrashModal();\n"
    "                showToast('Chat permanently deleted', 'success');\n"
    "            });"
)
new3 = (
    "            row.querySelector('.perm-delete').addEventListener('click', () => {\n"
    "                showConfirm('Permanently delete this chat? This cannot be undone.', () => {\n"
    "                    let list = JSON.parse(localStorage.getItem('stockSense_deletedChats') || '[]');\n"
    "                    list = list.filter(s => s.id !== sess.id);\n"
    "                    localStorage.setItem('stockSense_deletedChats', JSON.stringify(list));\n"
    "                    renderTrashModal();\n"
    "                    showToast('Chat permanently deleted', 'success');\n"
    "                }, { title: 'Delete Forever', variant: 'danger', confirmLabel: 'Delete' });\n"
    "            });"
)
txt_n = txt_n.replace(old3, new3, 1)

# ── 4. Delete conversation (deleteChatSession) ─────────────────────────────────
old4 = (
    "function deleteChatSession(id) {\n"
    "    const confirmDelete = confirm('Are you sure you want to delete this conversation?');\n"
    "    if (!confirmDelete) return;"
)
new4 = (
    "function deleteChatSession(id) {\n"
    "    showConfirm('Are you sure you want to delete this conversation?', () => {\n"
    "        _doDeleteChatSession(id);\n"
    "    }, { title: 'Delete Conversation', variant: 'danger', confirmLabel: 'Delete' });\n"
    "}\n"
    "function _doDeleteChatSession(id) {"
)
txt_n = txt_n.replace(old4, new4, 1)

# ── 5. Remove CSV data ─────────────────────────────────────────────────────────
# Wrap the entire clearFileBtn listener body
old5 = (
    "        clearFileBtn.addEventListener('click', async () => {\n"
    "            const confirmed = confirm('Remove CSV data? This will clear all inventory and forecast data from the app so it is ready for a fresh upload.');\n"
    "            if (!confirmed) return;"
)
new5 = (
    "        clearFileBtn.addEventListener('click', () => {\n"
    "            showConfirm('Remove CSV data? This will clear all inventory and forecast data from the app so it is ready for a fresh upload.', async () => {"
)
txt_n = txt_n.replace(old5, new5, 1)

# ── 6. Remove organization logo ────────────────────────────────────────────────
old6 = (
    "        removeAvatarBtn.addEventListener('click', async () => {\n"
    "            if (!confirm('Are you sure you want to remove your organization logo?')) return;"
)
new6 = (
    "        removeAvatarBtn.addEventListener('click', () => {\n"
    "            showConfirm('Are you sure you want to remove your organization logo?', async () => {"
)
txt_n = txt_n.replace(old6, new6, 1)

# ── 7. Sign out — desktop dropdown ────────────────────────────────────────────
old7 = (
    "            if(confirm('Are you sure you want to sign out?')) {\n"
    "                // Clear state\n"
    "                localStorage.removeItem('stockSense_storeName');\n"
    "                localStorage.removeItem('stockSense_industry');\n"
    "                localStorage.removeItem('stockSense_jwt');\n"
    "                // Reload to reset\n"
    "                window.location.reload();\n"
    "            }"
)
new7 = (
    "            showConfirm('You will be signed out of StockSense AI.', () => {\n"
    "                localStorage.removeItem('stockSense_storeName');\n"
    "                localStorage.removeItem('stockSense_industry');\n"
    "                localStorage.removeItem('stockSense_jwt');\n"
    "                window.location.reload();\n"
    "            }, { title: 'Sign Out', variant: 'warn', confirmLabel: 'Sign Out' });"
)
txt_n = txt_n.replace(old7, new7, 1)

# ── 8. Sign out — mobile ───────────────────────────────────────────────────────
old8 = (
    "            if(confirm('Are you sure you want to sign out?')) {\n"
    "                localStorage.removeItem('stockSense_storeName');\n"
    "                localStorage.removeItem('stockSense_industry');\n"
    "                localStorage.removeItem('stockSense_jwt');\n"
    "                window.location.reload();\n"
    "            }"
)
new8 = (
    "            showConfirm('You will be signed out of StockSense AI.', () => {\n"
    "                localStorage.removeItem('stockSense_storeName');\n"
    "                localStorage.removeItem('stockSense_industry');\n"
    "                localStorage.removeItem('stockSense_jwt');\n"
    "                window.location.reload();\n"
    "            }, { title: 'Sign Out', variant: 'warn', confirmLabel: 'Sign Out' });"
)
txt_n = txt_n.replace(old8, new8, 1)

# ── 9. Purge all data ──────────────────────────────────────────────────────────
old9_pat = re.compile(
    r"purgeBtn\.addEventListener\('click', async \(\) => \{\s*"
    r"const orgName = localStorage\.getItem\('stockSense_storeName'\) \|\| 'your organization';\s*"
    r"const confirmed = confirm\(\s*`[^`]+`\s*\);\s*"
    r"if \(!confirmed\) return;",
    re.DOTALL
)
new9 = (
    "purgeBtn.addEventListener('click', () => {\n"
    "            const orgName = localStorage.getItem('stockSense_storeName') || 'your organization';\n"
    "            showConfirm(`This will permanently delete ALL inventory and chat history for \"${orgName}\". This cannot be undone.`, async () => {"
)
txt_n = old9_pat.sub(new9, txt_n, count=1)

# ── 10. Delete PO record ───────────────────────────────────────────────────────
txt_n = txt_n.replace(
    "if (confirm(`Are you sure you want to delete PO Record ${poId}?`)) {",
    "showConfirm(`Are you sure you want to delete PO Record ${poId}?`, async () => {",
    1
)

# Write back with CRLF
out = txt_n.replace('\n', '\r\n')
with open('frontend/app.js', 'w', encoding='utf-8', newline='') as f:
    f.write(out)

# Check remaining
remaining = [(m.start(), txt_n[max(0,m.start()-60):m.start()+80]) for m in re.finditer(r'\bconfirm\(', txt_n)
             if 'showConfirm' not in txt_n[max(0,m.start()-15):m.start()]]
print(f"Remaining native confirm() calls: {len(remaining)}")
for _, ctx in remaining:
    print(f"  -> {ctx.strip()[:100]}")
