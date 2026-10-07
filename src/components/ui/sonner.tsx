import { Toaster as Sonner } from "sonner";
import type { ComponentProps } from "react";
import { useOfficeToastActive } from "@/components/office/OfficeToastLayer";

type ToasterProps = ComponentProps<typeof Sonner>;

const Toaster = ({ ...props }: ToasterProps) => {
  const officeActive = useOfficeToastActive();
  // OfficeToastLayer presents the same Sonner stream; do not consume it twice.
  if (officeActive) return null;
  return (
    <Sonner
      className={`toaster group${officeActive ? " office-sonner" : ""}`}
      expand={officeActive}
      gap={officeActive ? 8 : undefined}
      toastOptions={{
        classNames: {
          toast:
            "group toast group-[.toaster]:bg-background group-[.toaster]:text-foreground group-[.toaster]:border-border group-[.toaster]:shadow-lg",
          description: "group-[.toast]:text-muted-foreground",
          actionButton: "group-[.toast]:bg-primary group-[.toast]:text-primary-foreground",
          cancelButton: "group-[.toast]:bg-muted group-[.toast]:text-muted-foreground",
        },
      }}
      {...props}
    />
  );
};

export { Toaster };
