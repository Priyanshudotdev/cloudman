import { cn } from "@my-better-t-app/ui/lib/utils";
import { cva, type VariantProps } from "class-variance-authority";

const badgeVariants = cva(
	"inline-flex w-fit shrink-0 select-none items-center justify-center gap-1 overflow-hidden whitespace-nowrap rounded-sm border px-2 py-0.5 font-medium text-xs",
	{
		variants: {
			variant: {
				default: "border-transparent bg-primary text-primary-foreground",
				secondary: "border-transparent bg-muted text-muted-foreground",
				destructive:
					"border-transparent bg-destructive/10 text-destructive dark:bg-destructive/20",
				outline: "text-foreground",
			},
		},
		defaultVariants: {
			variant: "default",
		},
	},
);

function Badge({
	className,
	variant,
	...props
}: React.ComponentProps<"span"> & VariantProps<typeof badgeVariants>) {
	return (
		<span
			data-slot="badge"
			className={cn(badgeVariants({ variant }), className)}
			{...props}
		/>
	);
}

export { Badge, badgeVariants };
