import { getLocale, localeHtmlLang, t } from "./i18n";

export type CaptureSource = "mic" | "share" | "device";

export function recorderFormat(): { mime: string; ext: string } {
  const options = [
    { mime: "audio/webm;codecs=opus", ext: "webm" },
    { mime: "audio/webm", ext: "webm" },
    { mime: "audio/mp4", ext: "m4a" },
    { mime: "audio/ogg;codecs=opus", ext: "ogg" },
  ];
  if (typeof MediaRecorder === "undefined") return { mime: "", ext: "webm" };
  return options.find((item) => MediaRecorder.isTypeSupported(item.mime)) || { mime: "", ext: "webm" };
}

export async function listAudioInputs(): Promise<MediaDeviceInfo[]> {
  if (!navigator.mediaDevices?.enumerateDevices) return [];
  const devices = await navigator.mediaDevices.enumerateDevices();
  return devices.filter((item) => item.kind === "audioinput");
}

export async function captureAudio(source: CaptureSource, deviceId: string): Promise<MediaStream> {
  if (source === "share") {
    const display = await navigator.mediaDevices.getDisplayMedia({
      video: true,
      audio: true,
      systemAudio: "include",
    } as DisplayMediaStreamOptions);
    display.getVideoTracks().forEach((track) => track.stop());
    const audio = display.getAudioTracks();
    if (!audio.length) {
      display.getTracks().forEach((track) => track.stop());
      throw new Error(t("live.noShareAudio"));
    }
    return new MediaStream(audio);
  }
  if (source === "device") {
    if (!deviceId) throw new Error(t("live.pickInput"));
    return navigator.mediaDevices.getUserMedia({
      audio: {
        deviceId: { exact: deviceId },
        echoCancellation: false,
        noiseSuppression: false,
      },
    });
  }
  return navigator.mediaDevices.getUserMedia({
    audio: { echoCancellation: true, noiseSuppression: true },
  });
}

export function canDocumentPip(): boolean {
  return typeof window !== "undefined" && typeof window.documentPictureInPicture?.requestWindow === "function";
}

export function copyDocumentChrome(target: Document) {
  target.documentElement.lang = document.documentElement.lang || localeHtmlLang(getLocale());
  target.documentElement.dataset.theme = document.documentElement.dataset.theme || "dark";
  for (const node of document.head.querySelectorAll("link[rel='stylesheet'], style, link[rel='preconnect']")) {
    target.head.appendChild(node.cloneNode(true));
  }
}
