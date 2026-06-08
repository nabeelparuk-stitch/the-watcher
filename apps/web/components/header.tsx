import Link from "next/link";

export function Header() {
  return (
    <header>
      <Link href="/" className="brand">
        The Watcher
      </Link>
    </header>
  );
}
