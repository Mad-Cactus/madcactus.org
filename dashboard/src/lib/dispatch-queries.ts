import { query } from "@solidjs/router";
import { listPublishedDispatch, getPublishedDispatch } from "~/lib/dispatch";

export const getDispatchIssuesQuery = query(async () => {
	"use server";
	return listPublishedDispatch();
}, "dispatch-issues");

export const getDispatchIssueQuery = query(async (id: string) => {
	"use server";
	return getPublishedDispatch(id);
}, "dispatch-issue");
