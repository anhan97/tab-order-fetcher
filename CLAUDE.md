## MCP Tools: code-review-graph
ALWAYS use code-review-graph MCP tools BEFORE Grep/Glob/Read for
codebase exploration. Graph is faster, cheaper, and structural.

Fall back to Grep/Glob/Read only when:
- Log files / raw config
- Non-indexed language
- Specific string search the graph doesn't index

Priority tools:
- semantic_search_nodes_tool — find by name/keyword
- query_graph_tool — callers_of, callees_of, imports_of, tests_for
- detect_changes_tool — review current diff
- get_impact_radius_tool — blast radius of a change
