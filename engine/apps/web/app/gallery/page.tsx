import type { Metadata } from "next";
import { Gallery } from "./gallery";

export const metadata: Metadata = {
  title: "Component gallery",
};

export default function GalleryPage() {
  return <Gallery />;
}
