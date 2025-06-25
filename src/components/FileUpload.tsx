import {Show} from "solid-js";

/** Button to upload a JSONL log file */
export default function FileUpload(props: {
  id: string;
  label: string;
  icon: string;
  accept?: string;
  uploadedFile: File | null;
  // eslint-disable-next-line no-unused-vars
  onFileUpload: (event: Event) => void;
}) {
  return (
    <div class="upload-group">
      <label for={props.id} class="upload-label">
        {props.icon} {props.label}
      </label>
      <input
        id={props.id}
        type="file"
        accept={props.accept || ".jsonl"}
        onChange={e => props.onFileUpload(e)}
        class="file-input"
      />
      <Show when={props.uploadedFile}>
        <span class="file-status">✅ {props.uploadedFile?.name}</span>
      </Show>
    </div>
  );
}
