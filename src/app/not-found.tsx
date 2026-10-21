import { ButtonLink, Logo } from "@/components/ui";

export default function NotFound() {
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center gap-4 px-4 text-center">
      <Logo />
      <h1 className="font-display text-4xl font-semibold">Page not found</h1>
      <p className="text-muted">The page you were looking for doesn&apos;t exist or you don&apos;t have access to it.</p>
      <ButtonLink href="/">Go home</ButtonLink>
    </div>
  );
}
