// Part of the APK.audio project — http://APK.audio — made by Anthony Kuzub
// MIT Licence. Free, for everyone, for ever. Full text in LICENSE at the root.
/* apk-table.js — THE ONE TABLE. window.APKTable.

   Every table in the project is drawn by this file, so every table answers the
   same script. A page makes one with

     const t = APKTable.create(hostEl, {
       id: 'computer-interfaces',               // its name in the registry
       columns: [
         { key: 'name', label: 'IFace' },                       // editable text
         { key: 'speed', label: 'Speed', type: 'select', options: ['', '1 Gbps'] },
         { key: 'vlan', label: 'VLAN', type: 'number' },
         { key: 'mac', label: 'MAC', editable: false, mono: true },
       ],
       rows,                                    // array of plain objects
       onEdit(i, key, value, row) {},           // i = index in `rows`, whatever the sort
       onDelete(i, row) {},                     // present → a ✕ column
     });

   and any script — the page's own, the console, an automation — reaches every
   table the same way:

     APKTable.all()                 // [{ id, … }] every live table on the page
     APKTable.get('computer-interfaces')
       .rows() / .setRows(rows) / .sort('vlan', 'desc') / .filter('dante')
       .select(i) / .toCsv() / .exportCsv() / .copy() / .columns()

   Each <table> also carries data-apk-table="<id>", and every edit / delete /
   select is dispatched on it as a bubbling 'apk-table' CustomEvent
   ({ table, action, index, key, value }), so a script can listen to all
   tables at once on document.

   SERVED at /FrontEnd/shared/apk-table.js (+ apk-table.css), the same folder as
   apk-bus.js. A soft app that ships on its own carries a copy in
   vendor/apk-table/, held byte-identical by
   .apk.scripts/vendor_shared_web.py --check.

   Plain script, no framework, no build. Every cell is text (textContent), never
   HTML: rows come off the bus and off files. */
(function (root) {
    'use strict';

    var registry = new Map();
    var doc = root.document;

    function text(v) { return v === null || v === undefined ? '' : String(v); }

    function cmp(a, b) {
        var na = Number(a), nb = Number(b);
        if (text(a) !== '' && text(b) !== '' && isFinite(na) && isFinite(nb)) return na - nb;
        return text(a).localeCompare(text(b), undefined, { numeric: true, sensitivity: 'base' });
    }

    function csvCell(v) {
        var s = text(v);
        return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
    }

    function el(tag, cls, txt) {
        var e = doc.createElement(tag);
        if (cls) e.className = cls;
        if (txt !== undefined) e.textContent = txt;
        return e;
    }

    /** Make a table in `host`. Returns its handle (also APKTable.get(id)). */
    function create(host, opts) {
        if (!host) throw new Error('APKTable.create: no host element');
        opts = opts || {};
        var id = opts.id || ('table-' + (registry.size + 1));
        if (registry.has(id)) registry.get(id).destroy();

        var columns = (opts.columns || []).map(function (c) {
            return {
                key: c.key,
                label: c.label !== undefined ? c.label : c.key,
                type: c.type || 'text',
                options: c.options || [],
                editable: c.editable !== false && opts.editable !== false && c.type !== 'readonly',
                mono: !!c.mono,
                width: c.width || '',
                align: c.align || (c.type === 'number' ? 'right' : ''),
                format: c.format || null,
                placeholder: c.placeholder || '',
            };
        });
        var rows = opts.rows || [];
        var sortKey = null, sortDir = 1, query = '', selected = -1;

        var wrap = el('div', 'apk-table-wrap');
        var bar = el('div', 'apk-table-bar');
        var search = el('input', 'apk-table-search');
        search.type = 'search';
        search.placeholder = opts.searchPlaceholder || 'Filter';
        var count = el('span', 'apk-table-count');
        var csvBtn = el('button', 'apk-table-btn', 'CSV');
        csvBtn.type = 'button';
        csvBtn.title = 'Download this table as CSV';
        var copyBtn = el('button', 'apk-table-btn', 'Copy');
        copyBtn.type = 'button';
        copyBtn.title = 'Copy this table (tab-separated, pastes into a spreadsheet)';
        bar.appendChild(search);
        bar.appendChild(count);
        bar.appendChild(copyBtn);
        bar.appendChild(csvBtn);
        if (opts.toolbar === false) bar.hidden = true;

        var scroller = el('div', 'apk-table-scroll');
        var table = el('table', 'apk-table');
        table.setAttribute('data-apk-table', id);
        var thead = el('thead');
        var tbody = el('tbody');
        table.appendChild(thead);
        table.appendChild(tbody);
        scroller.appendChild(table);
        wrap.appendChild(bar);
        wrap.appendChild(scroller);
        host.innerHTML = '';
        host.appendChild(wrap);

        function emit(action, detail) {
            var d = { table: id, action: action };
            for (var k in detail) d[k] = detail[k];
            try { table.dispatchEvent(new root.CustomEvent('apk-table', { bubbles: true, detail: d })); } catch (e) { /* no CustomEvent */ }
        }

        function visible() {
            var idx = rows.map(function (_, i) { return i; });
            if (query) {
                var q = query.toLowerCase();
                idx = idx.filter(function (i) {
                    return columns.some(function (c) { return text(rows[i][c.key]).toLowerCase().indexOf(q) >= 0; });
                });
            }
            if (sortKey !== null) {
                idx.sort(function (a, b) { return sortDir * cmp(rows[a][sortKey], rows[b][sortKey]) || a - b; });
            }
            return idx;
        }

        function renderHead() {
            thead.innerHTML = '';
            var tr = el('tr');
            columns.forEach(function (c) {
                var th = el('th', c.align ? 'apk-align-' + c.align : '', c.label);
                if (c.width) th.style.width = c.width;
                if (opts.sortable !== false) {
                    th.classList.add('apk-sortable');
                    th.title = 'Sort by ' + c.label;
                    if (sortKey === c.key) th.setAttribute('aria-sort', sortDir > 0 ? 'ascending' : 'descending');
                    th.onclick = function () { handle.sort(c.key, sortKey === c.key && sortDir > 0 ? 'desc' : 'asc'); };
                }
                tr.appendChild(th);
            });
            if (opts.onDelete) tr.appendChild(el('th', 'apk-table-act', ''));
            thead.appendChild(tr);
        }

        function commit(i, c, value) {
            if (text(rows[i][c.key]) === text(value)) return;   // a blur is not an edit
            rows[i][c.key] = c.type === 'number' && value !== '' && isFinite(Number(value)) ? Number(value) : value;
            if (opts.onEdit) opts.onEdit(i, c.key, rows[i][c.key], rows[i]);
            emit('edit', { index: i, key: c.key, value: rows[i][c.key] });
        }

        function cell(i, c) {
            var td = el('td', (c.align ? 'apk-align-' + c.align : '') + (c.mono ? ' apk-mono' : ''));
            var v = rows[i][c.key];
            if (c.type === 'select' && c.editable) {
                var sel = el('select', 'apk-table-select');
                var opts2 = c.options.slice();
                if (opts2.indexOf(text(v)) < 0) opts2.push(text(v));
                opts2.forEach(function (o) {
                    var op = el('option', '', o === '' ? '—' : o);
                    op.value = o;
                    if (o === text(v)) op.selected = true;
                    sel.appendChild(op);
                });
                sel.onchange = function () { commit(i, c, sel.value); };
                td.appendChild(sel);
                return td;
            }
            td.textContent = c.format ? c.format(v, rows[i]) : text(v);
            if (c.editable) {
                td.contentEditable = 'true';
                td.classList.add('apk-editable');
                if (c.placeholder) td.setAttribute('data-placeholder', c.placeholder);
                td.onkeydown = function (e) {
                    if (e.key === 'Enter') { e.preventDefault(); td.blur(); }
                    if (e.key === 'Escape') { td.textContent = text(rows[i][c.key]); td.blur(); }
                };
                td.onblur = function () { commit(i, c, td.textContent.trim()); };
            }
            return td;
        }

        function renderBody() {
            tbody.innerHTML = '';
            var idx = visible();
            idx.forEach(function (i) {
                var tr = el('tr', i === selected ? 'apk-selected' : '');
                tr.setAttribute('data-index', i);
                columns.forEach(function (c) { tr.appendChild(cell(i, c)); });
                if (opts.onDelete) {
                    var td = el('td', 'apk-table-act');
                    var x = el('button', 'apk-table-del', '✕');
                    x.type = 'button';
                    x.title = 'Remove this row';
                    x.onclick = function (e) {
                        e.stopPropagation();
                        var row = rows[i];
                        opts.onDelete(i, row);
                        emit('delete', { index: i });
                    };
                    td.appendChild(x);
                    tr.appendChild(td);
                }
                tr.onclick = function (e) {
                    if (e.target.closest && e.target.closest('[contenteditable="true"], select, button')) return;
                    handle.select(i);
                };
                tbody.appendChild(tr);
            });
            if (!idx.length) {
                var tr = el('tr', 'apk-table-empty');
                var td = el('td', '', rows.length ? 'Nothing matches the filter.' : (opts.empty || 'No rows.'));
                td.colSpan = columns.length + (opts.onDelete ? 1 : 0);
                tr.appendChild(td);
                tbody.appendChild(tr);
            }
            count.textContent = idx.length === rows.length ? rows.length + ' rows' : idx.length + ' of ' + rows.length;
        }

        function render() { renderHead(); renderBody(); }

        var handle = {
            id: id,
            el: table,
            columns: function () { return columns.map(function (c) { return { key: c.key, label: c.label, type: c.type }; }); },
            rows: function () { return rows; },
            setRows: function (r) { rows = r || []; if (selected >= rows.length) selected = -1; renderBody(); return handle; },
            sort: function (key, dir) {
                sortKey = key === null || key === undefined ? null : key;
                sortDir = dir === 'desc' ? -1 : 1;
                render();
                return handle;
            },
            filter: function (q) { query = text(q); if (search.value !== query) search.value = query; renderBody(); return handle; },
            select: function (i) {
                selected = i;
                renderBody();
                if (opts.onSelect) opts.onSelect(i, rows[i]);
                emit('select', { index: i });
                return handle;
            },
            /** The table as CSV — the rows shown (filter and sort applied), with a header. */
            toCsv: function (sep) {
                sep = sep || ',';
                var line = function (cells) { return cells.map(sep === ',' ? csvCell : text).join(sep); };
                var out = [line(columns.map(function (c) { return c.label; }))];
                visible().forEach(function (i) {
                    out.push(line(columns.map(function (c) { return c.format ? c.format(rows[i][c.key], rows[i]) : rows[i][c.key]; })));
                });
                return out.join('\n');
            },
            exportCsv: function (filename) {
                var blob = new root.Blob([handle.toCsv()], { type: 'text/csv;charset=utf-8' });
                var a = el('a');
                a.href = root.URL.createObjectURL(blob);
                a.download = filename || (id + '.csv');
                doc.body.appendChild(a);
                a.click();
                a.remove();
                setTimeout(function () { root.URL.revokeObjectURL(a.href); }, 1000);
                return handle;
            },
            copy: function () {
                var tsv = handle.toCsv('\t');
                if (root.navigator && root.navigator.clipboard) return root.navigator.clipboard.writeText(tsv).then(function () { return handle; });
                return Promise.resolve(handle);
            },
            render: function () { render(); return handle; },
            destroy: function () { registry.delete(id); if (wrap.parentNode) wrap.parentNode.removeChild(wrap); },
        };

        search.oninput = function () { query = search.value; renderBody(); };
        csvBtn.onclick = function () { handle.exportCsv(); };
        copyBtn.onclick = function () {
            handle.copy().then(function () { copyBtn.textContent = 'Copied'; setTimeout(function () { copyBtn.textContent = 'Copy'; }, 1200); });
        };

        registry.set(id, handle);
        render();
        return handle;
    }

    var api = {
        create: create,
        get: function (id) { return registry.get(id) || null; },
        all: function () { return Array.from(registry.values()); },
    };
    root.APKTable = api;
    if (typeof module === 'object' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
