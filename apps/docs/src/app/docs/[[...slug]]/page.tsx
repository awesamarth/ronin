import { source } from "@/lib/source";
import { DocsBody, DocsDescription, DocsPage, DocsTitle } from "fumadocs-ui/page";
import defaultMdxComponents from "fumadocs-ui/mdx";
import { notFound } from "next/navigation";
import type { ComponentProps, ComponentType } from "react";

type MdxPageData = {
  body: ComponentType<{ components?: typeof defaultMdxComponents }>;
  description?: string;
  full?: boolean;
  title: string;
  toc?: ComponentProps<typeof DocsPage>["toc"];
};

function isMdxPageData(value: unknown): value is MdxPageData {
  if (!value || typeof value !== "object") return false;
  const data = value as Record<string, unknown>;
  return typeof data.body === "function"
    && typeof data.title === "string"
    && (data.description === undefined || typeof data.description === "string")
    && (data.full === undefined || typeof data.full === "boolean")
    && (data.toc === undefined || Array.isArray(data.toc));
}

export default async function Page(props: { params: Promise<{ slug?: string[] }> }) {
  const params = await props.params;
  const page = source.getPage(params.slug);

  if (!page || !isMdxPageData(page.data)) notFound();

  const MDX = page.data.body;

  return (
    <DocsPage toc={page.data.toc} full={page.data.full}>
      <DocsTitle>{page.data.title}</DocsTitle>
      <DocsDescription>{page.data.description}</DocsDescription>
      <DocsBody>
        <MDX components={defaultMdxComponents} />
      </DocsBody>
    </DocsPage>
  );
}

export async function generateStaticParams() {
  return source.generateParams();
}

export async function generateMetadata(props: { params: Promise<{ slug?: string[] }> }) {
  const params = await props.params;
  const page = source.getPage(params.slug);

  if (!page) notFound();

  return {
    title: page.data.title,
    description: page.data.description,
  };
}
