import { api } from './api';
// @ts-ignore
const bold = window.bold;
export async function syncLoop(branch_id) {
    try {
        // push
        const outbox = await bold.sync_get_outbox();
        let pushFailed = false;
        if (outbox.length) {
            for (const item of outbox) {
                try {
                    await api.sale(JSON.parse(item.payload));
                    await bold.sync_mark_sent([item.id]);
                }
                catch (e) {
                    pushFailed = true;
                }
            }
        }
        // Never overwrite locally reserved stock with a server snapshot while a
        // sale command is still pending. The next successful loop pushes first.
        if (pushFailed)
            return;
        // pull
        const data = await api.pull(branch_id);
        await bold.sync_apply_pull(data);
    }
    catch (e) {
        console.log('sync offline', e);
    }
}
export function startSync(branch_id) {
    syncLoop(branch_id);
    const timer = setInterval(() => syncLoop(branch_id), 15000);
    return () => clearInterval(timer);
}
