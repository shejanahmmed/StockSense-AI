import re

UTILITY = '''
// ──────────────────────────────────────────────────────────────────────────────
// showConfirm — custom async confirm dialog (replaces native browser confirm())
// Usage: showConfirm(message, onConfirm, { title, icon, variant, confirmLabel })
// variant: 'danger' (default) | 'warn' | 'info'
// ──────────────────────────────────────────────────────────────────────────────
function showConfirm(message, onConfirm, opts) {
    opts = opts || {};
    const overlay   = document.getElementById('customConfirmOverlay');
    const iconWrap  = document.getElementById('customConfirmIconWrap');
    const iconEl    = document.getElementById('customConfirmIcon');
    const titleEl   = document.getElementById('customConfirmTitle');
    const msgEl     = document.getElementById('customConfirmMessage');
    const okBtn     = document.getElementById('customConfirmOk');
    const cancelBtn = document.getElementById('customConfirmCancel');
    if (!overlay) { if (onConfirm && confirm(message)) onConfirm(); return; }

    const variant  = opts.variant || 'danger';
    const iconMap  = { danger: 'fa-triangle-exclamation', warn: 'fa-circle-exclamation', info: 'fa-circle-question' };

    titleEl.textContent = opts.title || 'Are you sure?';
    msgEl.textContent   = message;
    okBtn.textContent   = opts.confirmLabel || 'Confirm';

    iconWrap.className  = 'custom-confirm-icon-wrap' + (variant !== 'danger' ? ' ' + variant : '');
    iconEl.className    = 'fa-solid ' + (iconMap[variant] || iconMap.danger);
    okBtn.className     = 'custom-confirm-ok' + (variant === 'warn' ? ' btn-warn' : variant === 'info' ? ' btn-info' : '');

    overlay.classList.add('open');
    document.body.style.overflow = 'hidden';

    function close() {
        overlay.classList.remove('open');
        document.body.style.overflow = '';
        overlay.removeEventListener('click', handleBackdrop);
    }
    function handleOk()        { close(); if (onConfirm) onConfirm(); }
    function handleCancel()    { close(); }
    function handleBackdrop(e) { if (e.target === overlay) close(); }

    okBtn.addEventListener('click',     handleOk,       { once: true });
    cancelBtn.addEventListener('click', handleCancel,   { once: true });
    overlay.addEventListener('click',   handleBackdrop);
}

'''

with open('frontend/app.js', 'r', encoding='utf-8') as f:
    txt = f.read()

# Prepend utility
txt = UTILITY + txt

# ── 1. Delete SKU ─────────────────────────────────────────────────────────────
old = "if (confirm(`Are you sure you want to delete SKU ${sku}?`)) {"
new = "showConfirm(`Are you sure you want to delete SKU ${sku}?`, async () => {"
txt = txt.replace(old, new, 1)

# ── 2. Clear chat history ─────────────────────────────────────────────────────
old = (
    "                const confirmed = confirm('Are you sure you want to clear your chat history? This cannot be undone.');\r\n"
    "                if (!confirmed) return;\r\n"
    "                await clearChatHistoryFrontend();"
)
new = (
    "                showConfirm('Are you sure you want to clear your chat history? This cannot be undone.', async () => {\r\n"
    "                    await clearChatHistoryFrontend();\r\n"
    "                }, { title: 'Clear Chat History', variant: 'danger', confirmLabel: 'Clear All' });"
)
txt = txt.replace(old, new, 1)

# ── 3. Permanently delete chat (trash modal) ───────────────────────────────────
old = (
    "            row.querySelector('.perm-delete').addEventListener('click', () => {\r\n"
    "                if (!confirm('Permanently delete this chat? This cannot be undone.')) return;\r\n"
    "                let list = JSON.parse(localStorage.getItem('stockSense_deletedChats') || '[]');\r\n"
    "                list = list.filter(s => s.id !== sess.id);\r\n"
    "                localStorage.setItem('stockSense_deletedChats', JSON.stringify(list));\r\n"
    "                renderTrashModal();\r\n"
    "                showToast('Chat permanently deleted', 'success');\r\n"
    "            });"
)
new = (
    "            row.querySelector('.perm-delete').addEventListener('click', () => {\r\n"
    "                showConfirm('Permanently delete this chat? This cannot be undone.', () => {\r\n"
    "                    let list = JSON.parse(localStorage.getItem('stockSense_deletedChats') || '[]');\r\n"
    "                    list = list.filter(s => s.id !== sess.id);\r\n"
    "                    localStorage.setItem('stockSense_deletedChats', JSON.stringify(list));\r\n"
    "                    renderTrashModal();\r\n"
    "                    showToast('Chat permanently deleted', 'success');\r\n"
    "                }, { title: 'Delete Forever', variant: 'danger', confirmLabel: 'Delete' });\r\n"
    "            });"
)
txt = txt.replace(old, new, 1)

# ── 4. Delete conversation (deleteChatSession) ────────────────────────────────
old = (
    "function deleteChatSession(id) {\r\n"
    "    const confirmDelete = confirm('Are you sure you want to delete this conversation?');\r\n"
    "    if (!confirmDelete) return;"
)
new = (
    "function deleteChatSession(id) {\r\n"
    "    showConfirm('Are you sure you want to delete this conversation?', () => {\r\n"
    "        _doDeleteChatSession(id);\r\n"
    "    }, { title: 'Delete Conversation', variant: 'danger', confirmLabel: 'Delete' });\r\n"
    "}\r\n"
    "function _doDeleteChatSession(id) {"
)
txt = txt.replace(old, new, 1)

# ── 5. Remove CSV data ────────────────────────────────────────────────────────
old = (
    "            const confirmed = confirm('Remove CSV data? This will clear all inventory and forecast data from the app so it is ready for a fresh upload.');\r\n"
    "            if (!confirmed) return;"
)
new = (
    "            showConfirm('Remove CSV data? This will clear all inventory and forecast data from the app so it is ready for a fresh upload.', async () => {\r\n"
    "                // Continue with clear\r\n"
    "            }, { title: 'Remove CSV Data', variant: 'warn', confirmLabel: 'Remove' });\r\n"
    "            // Note: actual clear logic runs inside callback above — return early here\r\n"
    "            return; // placeholder — see below"
)
# Actually this one is tricky because the code after follows sequentially.
# Better approach: just find and remove the guard, wrapping the whole listener body
# For now just do the simple replacement so the guard is gone
old5b = (
    "        clearFileBtn.addEventListener('click', async () => {\r\n"
    "            const confirmed = confirm('Remove CSV data? This will clear all inventory and forecast data from the app so it is ready for a fresh upload.');\r\n"
    "            if (!confirmed) return;"
)
new5b = (
    "        clearFileBtn.addEventListener('click', async () => {\r\n"
    "            await new Promise(resolve => {\r\n"
    "                showConfirm('Remove CSV data? This will clear all inventory and forecast data from the app so it is ready for a fresh upload.', resolve,\r\n"
    "                    { title: 'Remove CSV Data', variant: 'warn', confirmLabel: 'Remove' });\r\n"
    "            }).then(async () => {"
)
# This wrapping approach is too complex — just use a simple guard replacement
# Simplest: wrap whole handler
if old5b in txt:
    print("Found clear CSV listener")
else:
    print("NOT found — checking alternate")
    # Try without the specific indent
    idx = txt.find("confirm('Remove CSV data?")
    print("Index of remove CSV confirm:", idx)
    print(repr(txt[idx-200:idx+300]))

with open('frontend/app.js', 'w', encoding='utf-8') as f:
    f.write(txt)

remaining = [(m.start(), txt[max(0,m.start()-60):m.start()+80]) for m in re.finditer(r'\bconfirm\(', txt) if 'showConfirm' not in txt[max(0,m.start()-15):m.start()]]
print(f"\nRemaining native confirm() calls: {len(remaining)}")
for idx, ctx in remaining:
    print(f"  ~line {txt[:idx].count(chr(10))+1}: {ctx.strip()[:80]}")
