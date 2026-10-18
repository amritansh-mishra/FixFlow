// Photos on a ticket: thumbnails, an "Add photo" button, and a full-size view.

import { useCallback, useEffect, useRef, useState, type ChangeEvent } from "react";
import { api, errorMessage, MAX_PHOTO_BYTES, MAX_PHOTOS_PER_TICKET, PHOTO_TYPES, type Attachment } from "../api";
import { isManager, useAuth } from "../auth";
import { ErrorBox, formatDate } from "./ui";

// Download links expire after 5 minutes; refresh them a bit sooner.
const REFRESH_MS = 4 * 60 * 1000;

export function TicketPhotos({ ticketId }: { ticketId: string }) {
  const { token, user } = useAuth();
  const [photos, setPhotos] = useState<Attachment[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [viewing, setViewing] = useState<Attachment | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    try {
      const res = await api<{ data: Attachment[] }>(`/api/tickets/${ticketId}/attachments`, { token });
      setPhotos(res.data);
    } catch (err) {
      setError(errorMessage(err));
    }
  }, [ticketId, token]);

  useEffect(() => {
    void load();
    const timer = setInterval(() => void load(), REFRESH_MS);
    return () => clearInterval(timer);
  }, [load]);

  // Close the full-size view with Escape.
  useEffect(() => {
    if (!viewing) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setViewing(null);
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [viewing]);

  async function onFileChosen(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = ""; // allow choosing the same file again
    if (!file) return;
    setError(null);

    // Quick checks in the browser for instant feedback. The server checks
    // again (including the file's real contents), so these aren't security.
    if (!PHOTO_TYPES.includes(file.type)) return setError("Choose a JPEG, PNG or WebP photo.");
    if (file.size > MAX_PHOTO_BYTES) return setError("That photo is larger than 5 MB.");

    const form = new FormData();
    form.append("photo", file);
    setUploading(true);
    try {
      await api(`/api/tickets/${ticketId}/attachments`, { method: "POST", token, body: form });
      await load();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setUploading(false);
    }
  }

  async function removePhoto(photo: Attachment) {
    if (!window.confirm(`Remove "${photo.fileName}"? This can't be undone.`)) return;
    setError(null);
    try {
      await api(`/api/tickets/${ticketId}/attachments/${photo.id}`, { method: "DELETE", token });
      setViewing(null);
      await load();
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  // Same rule as the API: the uploader, a manager or an admin.
  const canRemove = (photo: Attachment) => photo.uploadedBy === user?.id || isManager(user);

  const full = photos.length >= MAX_PHOTOS_PER_TICKET;

  return (
    <section className="photos">
      <div className="photos-header">
        <h2>
          Photos <span className="muted small">({photos.length}/{MAX_PHOTOS_PER_TICKET})</span>
        </h2>
        <button className="button small" onClick={() => fileInput.current?.click()} disabled={uploading || full}>
          {uploading ? "Uploading…" : full ? "Photo limit reached" : "+ Add photo"}
        </button>
        <input
          ref={fileInput}
          type="file"
          accept={PHOTO_TYPES.join(",")}
          onChange={(e) => void onFileChosen(e)}
          hidden
          aria-label="Choose a photo"
        />
      </div>
      <ErrorBox message={error} />

      {photos.length === 0 ? (
        <p className="muted small">No photos yet. A photo often explains the problem faster than words.</p>
      ) : (
        <ul className="photo-grid">
          {photos.map((photo) => (
            <li key={photo.id}>
              <button className="photo-thumb" onClick={() => setViewing(photo)} title={photo.fileName}>
                {/* If a link expired (e.g. after the laptop slept), fetch fresh ones. */}
                <img src={photo.thumbnailUrl} alt={photo.fileName} loading="lazy" onError={() => void load()} />
              </button>
            </li>
          ))}
        </ul>
      )}

      {viewing && (
        <div className="lightbox" role="dialog" aria-label={viewing.fileName} onClick={() => setViewing(null)}>
          <figure onClick={(e) => e.stopPropagation()}>
            <img src={viewing.url} alt={viewing.fileName} />
            <figcaption>
              <span>{viewing.fileName}</span>
              <span className="muted small">
                {formatDate(viewing.createdAt)} · {Math.max(1, Math.round(viewing.sizeBytes / 1024))} KB
              </span>
              {canRemove(viewing) && (
                <button className="button small danger" onClick={() => void removePhoto(viewing)}>
                  Remove
                </button>
              )}
              <button className="button small" onClick={() => setViewing(null)}>
                Close
              </button>
            </figcaption>
          </figure>
        </div>
      )}
    </section>
  );
}
