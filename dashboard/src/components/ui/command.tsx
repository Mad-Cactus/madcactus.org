// shadcn/ui "command" (cmdk) ported to Solid via cmdk-solid (Kobalte-based,
// matching the rest of ui/). Same part API as shadcn: Command.Dialog/Input/
// List/Empty/Group/Item/Separator. Styling lives in app.css under [cmdk-*]
// selectors so components keep the app's hand-rolled look.
import { Command as Cmdk } from "cmdk-solid";

export const Command = Cmdk;
export const CommandDialog = Cmdk.Dialog;
export const CommandEmpty = Cmdk.Empty;
export const CommandGroup = Cmdk.Group;
export const CommandInput = Cmdk.Input;
export const CommandItem = Cmdk.Item;
export const CommandList = Cmdk.List;
export const CommandSeparator = Cmdk.Separator;
