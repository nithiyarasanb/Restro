export default function CustomerLayout({ children }: LayoutProps<"/">) {
  return <div className="flex flex-1 flex-col sm:px-4">{children}</div>;
}
