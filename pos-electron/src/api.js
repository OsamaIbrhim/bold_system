const API = localStorage.getItem('bold_api') || 'http://localhost:3000/api/v1';
export const api = {
    base: API,
    async search(q, branch_id) {
        const r = await fetch(`${API}/products/search?q=${encodeURIComponent(q)}${branch_id ? `&branch_id=${branch_id}` : ''}`, { headers: { Authorization: `Bearer ${localStorage.getItem('token') || ''}` } });
        return r.ok ? r.json() : [];
    },
    async sale(payload) {
        const r = await fetch(`${API}/pos/sale`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${localStorage.getItem('token') || ''}` }, body: JSON.stringify(payload) });
        return r.json();
    }
};
