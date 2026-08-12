/**
 * Request builders for route tests.
 *
 * `postRequest` builds a real web Request whose body is a real multipart
 * FormData, so the handler runs the same parse path production does.
 * `stubRequest` exists only for the size-cap cases: proving the 20MB per-file
 * and 80MB aggregate gates through a real body would mean allocating and
 * serialising ~90MB, so those tests hand the handler a pre-parsed FormData with
 * the reported `size` overridden.
 */

export const TEST_IP = '203.0.113.7';

export function makeFile(bytes, { name = 'photo.jpg', type = 'image/jpeg', size } = {}) {
    const file = new File([bytes], name, { type });
    if (size !== undefined) {
        Object.defineProperty(file, 'size', { value: size, configurable: true });
    }
    return file;
}

export function buildFormData({ file, fields = {}, entries = [], fileField = 'file' } = {}) {
    const form = new FormData();
    if (file !== undefined && file !== null) form.append(fileField, file);
    for (const [key, value] of Object.entries(fields)) form.append(key, value);
    for (const [key, value] of entries) form.append(key, value);
    return form;
}

export function postRequest(url, body, { headers = {}, method = 'POST' } = {}) {
    return new Request(url, {
        method,
        body,
        headers: { 'x-real-ip': TEST_IP, ...headers },
    });
}

export function jsonRequest(url, payload, { headers = {}, raw } = {}) {
    return new Request(url, {
        method: 'POST',
        body: raw ?? JSON.stringify(payload),
        headers: { 'content-type': 'application/json', 'x-real-ip': TEST_IP, ...headers },
    });
}

export function getRequest(url, { headers = {} } = {}) {
    return new Request(url, { method: 'GET', headers: { 'x-real-ip': TEST_IP, ...headers } });
}

export function deleteRequest(url, { headers = {} } = {}) {
    return new Request(url, { method: 'DELETE', headers: { 'x-real-ip': TEST_IP, ...headers } });
}

export function stubRequest(url, form, { headers = {}, method = 'POST' } = {}) {
    return {
        url,
        method,
        headers: new Headers({ 'x-real-ip': TEST_IP, ...headers }),
        formData: async () => form,
    };
}

export async function readBody(response) {
    return response.json();
}

export async function readBytes(response) {
    return Buffer.from(await response.arrayBuffer());
}
