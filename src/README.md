Note: This will eventually be donated/integrated into @redwoodjs/redwood.

# Overview

- `/project`: The main API and classes (such as Project, Page, Service, Side, etc)
- `/language-server`: A [Language Server Protocol](https://microsoft.github.io/language-server-protocol/) implementation that wraps the `project` classes
- `/typescript-language-service-plugin`: A TypeScript language service plugin for redwood.

Eventually these modules could be published as independent packages.

# Usage

The most common use-case is getting the diagnostics of a complete redwood project:

```ts
import { Project } from "@redwoodjs/project";
const project = new Project({ projectRoot: "/foo/bar" });
for (const d of project.diagnostics) {
  console.log(d.severity + ": " + d.message);
}
// ...
// error: Router must have only one "notfound" page
// error: Duplicate path in router: '/about-us'
// error: Parameter "id" in route '/product/{id}' does not exist on ProductPage
// error: PostsCell is missing the "Success" exported const
// error: Property "emial" does not exist on "User" model
// warning: Unused page AboutUs.js
```

Note: Gathering _all_ diagnostics is expensive. It will trigger the creation of the complete project graph.
You can also traverse the graph to get more specific information.

For example: Iterating over the routes of a redwood project:

```ts
import { Project } from "@redwoodjs/project";
const project = new Project({ projectRoot: "/foo/bar" });
for (const route of project.web.router.routes) {
  console.log(route.path + (route.isPrivate ? " (private)" : ""));
}
// /
// /about
// /product/{id}
// /admin (private)
```

You can also get nodes by `id`. For example:

```ts
import { Project } from "@redwoodjs/project";
const project = new Project({ projectRoot: "/foo/bar" });
const router = project.findNode("/foo/bar/web/src/Routes.js");
```

(You can read more about `id`s below).

In most cases, if you just want to get the node for a given file, you don't even need to create a project by hand:

```ts
import { findNode } from "@redwoodjs/project";
findNode("/foo/bar/web/src/Routes.js")?.diagnostics?.length; // 8
```

The findNode utility method will recursively look for a redwood.toml file to identify where the project root might be.

# Diagnostics

The Diagnostics API/structures are based on the Language Server Protocol.

# Design Notes

- The project is represented by an AST of sorts
- Nodes are created lazily as the user traverses properties
- There is extensive caching going on under the hood. **If the underlying project changes, you need to create a new project**

## id

- Each node in the graph has an `id` property.
- ids are unique and stable
- They are organized in a hierarchical fashion (so the graph can be flattened as a tree)
- Requesting a node using its id will not require the complete project to be processed. Only the subset that is needed (usually only the node's ancestors). This is important to enable efficient IDE-like tooling to interact with the project graph and get diagnostics for quickly changing files.

Here are some examples of ids:

- (Project)
  - id: `"/project/root"`
  - webSide: (WebSide)
    - id: `"/project/root/web"`
    - router: (Router)
      - id: `"/project/root/web/src/Routes.js"`
      - routes[0]: (Route)
        - id: `"/project/root/web/src/Routes.js /home"` (notice that this id has two elements - it is an "internal" node)

An id is "usually" a file or folder.

Anatomy of an id:

- An id is a string.
- It has components separated by spaces.
- the first component is always a filePath (or folder path).
- The rest are optional, and only exist when the node is internal to a file.

## Mutations

- The project graph is immutable: If the underlying files change, you must create a new project.
- This allows us to keep the logic clean and focused on capturing the "rules" that are unique to a Redwood app (most importantly, diagnostics). Other concerns such as change management, reactivity, etc, can be added on top
- Having said that, the graph also provides some ways of modifying your Redwood apps. For example:

```ts
import { Project } from "@redwoodjs/model";
const project = new Project({ projectRoot: "/foo/bar" });
// lets find the "/home" page and delete it
const home = project.web?.router?.routes?.find((r) => r.path === "/home");
if (home) {
  const edits = home.remove();
  // returns a list of edits that need to be applied to your project's files
  // in this case, some file deletions and some file modifications
}
```

Some diagnostics provide a "quickFix", which is a list of edits that will "fix" the error.

For example, let's create an empty "page" file and then get its diagnostics:

```ts
import { findNode } from "@redwoodjs/model";
const pageNode = findNode("/foo/bar/web/src/pages/AboutUs/AboutUs.js");
pageNode.diagnostics[0].message; // this Page is empty
pageNode.diagnostics[0].quickFix.edits; // a list of edits to fix the problem
pageNode.diagnostics[0].quickFix.edits.apply();
```

You can apply the edits

## Abstracting File System Access

To allow use cases like dealing with unsaved files in IDEs, the filesystem access can be completely overriden.

Libraries with native/expensive dependencies (like prisma, or graphql) must also be injected via the host. This allows us to use the redwood project model, without modification, in the browser.

## Sync VS Async

When possible, the project graph is constructed synchronously. There are only a few exceptions. This simplifies the domain logic and validations, which is the main driver behind the project model itself.
The downside of this is that, when using the project model aggressively.... this can be solved by providing a cached filesystem access layer.

# High level, stable, use-case specific APIs

Instead of relying on the low level API (the nodes themselves), which are constantly changing as we add more features into redwood, we also provide a few use-case specific APIs that should be significantly stable:

## getDiagnostics

- Get the diagnostics of a complete project

```ts
import { getDiagnostics } from "@redwoodjs/model";
async function example() {
  const diagnostics = await getDiagnostics("path/to/my/project");
  for (const d of diagnostics) {
    const {
      message,
      severity,
      loc: { file, start, end },
    } = d;
  }
}
```

## getOutline

For IDEs and navigation
TODO:
