import {createSignal, JSX, Show, onMount, onCleanup} from "solid-js";
import xIcon from "~/assets/x.svg";

interface DialogProps {
  children: JSX.Element;
  trigger: JSX.Element;
  title?: string;
  onOpen?: () => void;
  onClose?: () => void;
}

/** Create a Dialog popup easily */
export default function Dialog(props: DialogProps) {
  const [isOpen, setIsOpen] = createSignal(false);
  let dialogRef: HTMLDialogElement | undefined;

  const openDialog = () => {
    setIsOpen(true);
    props.onOpen?.();
    document.body.style.overflow = "hidden";
  };

  const closeDialog = () => {
    setIsOpen(false);
    props.onClose?.();
    document.body.style.overflow = "";
  };

  // Handle escape key and backdrop clicks
  const handleDialogClick = (e: MouseEvent) => {
    if (e.target === dialogRef) {
      closeDialog();
    }
  };

  const handleKeyDown = (e: KeyboardEvent) => {
    if (e.key === "Escape" && isOpen()) {
      closeDialog();
    }
  };

  onMount(() => {
    document.addEventListener("keydown", handleKeyDown);
  });

  onCleanup(() => {
    document.removeEventListener("keydown", handleKeyDown);
    document.body.style.overflow = "";
  });

  return (
    <>
      <div onClick={openDialog}>{props.trigger}</div>
      <Show when={isOpen()}>
        <dialog
          ref={dialogRef}
          open
          onClick={handleDialogClick}
          style={{
            position: "fixed",
            top: "0",
            left: "0",
            width: "100%",
            height: "100%",
            border: "none",
            "background-color": "rgba(0, 0, 0, 0.5)",
            display: "flex",
            "align-items": "center",
            "justify-content": "center",
          }}
        >
          <div
            onClick={e => e.stopPropagation()}
            style={{
              "background-color": "white",
              "border-radius": "8px",
              padding: "1rem",
              "max-width": "90vw",
              "max-height": "90vh",
              overflow: "auto",
              position: "relative",
            }}
          >
            <button
              class="btn-close"
              title={`Close ${props.title || "dialog"}`}
              onClick={closeDialog}
              style={{
              position: "absolute",
              "background-color": "#f0f0f0",
              top: "1rem",
              right: "1rem",
              border: "none",
              cursor: "pointer",
              padding: "0.35rem",
              display: "flex",
              "align-items": "center",
              "justify-content": "center",
              "border-radius": "50%",
              transform: "scale(0.8)",
              }}
            >
              <img src={xIcon} alt="Close dialog" class="iconBtn" />
            </button>

            <div style={{"margin-top": "2rem"}}>{props.children}</div>
          </div>
        </dialog>
      </Show>
    </>
  );
}
