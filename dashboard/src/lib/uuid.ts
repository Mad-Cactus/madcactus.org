// lowercase uuid check shared by docs + dispatch (public route inputs are
// trust boundaries — postgres throws on malformed uuids otherwise)
export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
