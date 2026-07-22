import type { ClassValue } from "clsx";
import clsx from "clsx";
import { twMerge } from "tailwind-merge";
import { defineConfig } from "cva";

export const { cva, cx, compose } = defineConfig({
	hooks: {
		onComplete: (className) => twMerge(className),
	},
});

export const cn = (...classLists: ClassValue[]) => twMerge(clsx(classLists));
