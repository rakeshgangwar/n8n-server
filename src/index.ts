#!/usr/bin/env node
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ErrorCode,
  ListToolsRequestSchema,
  McpError,
} from '@modelcontextprotocol/sdk/types.js';
import axios, { AxiosError } from 'axios';

const API_URL = process.env.N8N_API_URL || '';
const API_KEY = process.env.N8N_API_KEY || '';

if (!API_URL || !API_KEY) {
  console.error('N8N_API_URL and N8N_API_KEY environment variables are required');
}

// Make sure API_URL ends with /api/v1 
const baseUrl = API_URL.endsWith('/api/v1') ? API_URL : `${API_URL}/api/v1`;

// Types for n8n API responses
interface N8nWorkflow {
  id: string;
  name: string;
  active: boolean;
  nodes: any[];
  connections: Record<string, any>;
  tags: string[];
}

interface N8nExecution {
  id: string;
  finished: boolean;
  status: string;
  data: any;
}

// Tool argument types
interface ListWorkflowsArgs {
  active?: boolean;
  tags?: string[];
}

interface WorkflowIdArg {
  id: string;
}

interface CreateWorkflowArgs {
  name: string;
  nodes?: any[];
  connections?: Record<string, any>;
  active?: boolean;
  tags?: string[];
  settings?: Record<string, any>;
}

interface UpdateWorkflowArgs {
  id: string;
  name?: string;
  nodes?: any[];
  connections?: Record<string, any>;
  active?: boolean;
  tags?: string[];
}

interface ExecuteWorkflowArgs {
  id: string;
  data?: Record<string, any>;
}

// Validation functions
function validateWorkflowId(args: Record<string, unknown>): WorkflowIdArg {
  if (!args.id || typeof args.id !== 'string') {
    throw new McpError(ErrorCode.InvalidParams, 'Workflow ID is required and must be a string');
  }
  return { id: args.id };
}

function validateCreateWorkflow(args: Record<string, unknown>): CreateWorkflowArgs {
  if (!args.name || typeof args.name !== 'string') {
    throw new McpError(ErrorCode.InvalidParams, 'Workflow name is required and must be a string');
  }
  return {
    name: args.name,
    nodes: Array.isArray(args.nodes) ? args.nodes : [],
    connections: typeof args.connections === 'object' ? args.connections as Record<string, any> : {},
    active: typeof args.active === 'boolean' ? args.active : false,
    tags: Array.isArray(args.tags) ? args.tags : [],
    settings: typeof args.settings === 'object' && args.settings !== null ? args.settings as Record<string, any> : { executionOrder: "v1" },
  };
}

function validateUpdateWorkflow(args: Record<string, unknown>): UpdateWorkflowArgs {
  if (!args.id || typeof args.id !== 'string') {
    throw new McpError(ErrorCode.InvalidParams, 'Workflow ID is required and must be a string');
  }
  return {
    id: args.id,
    name: typeof args.name === 'string' ? args.name : undefined,
    nodes: Array.isArray(args.nodes) ? args.nodes : undefined,
    connections: typeof args.connections === 'object' ? args.connections as Record<string, any> : undefined,
    active: typeof args.active === 'boolean' ? args.active : undefined,
    tags: Array.isArray(args.tags) ? args.tags : undefined,
  };
}

function validateExecuteWorkflow(args: Record<string, unknown>): ExecuteWorkflowArgs {
  if (!args.id || typeof args.id !== 'string') {
    throw new McpError(ErrorCode.InvalidParams, 'Workflow ID is required and must be a string');
  }
  return {
    id: args.id,
    data: typeof args.data === 'object' ? args.data as Record<string, any> : {},
  };
}

class N8nServer {
  private server: Server;
  private axiosInstance;

  constructor() {
    this.server = new Server(
      {
        name: 'n8n-server',
        version: '0.1.0',
      },
      {
        capabilities: {
          tools: {},
        },
      }
    );

    // Debug output
    console.error(`Connecting to n8n API: ${baseUrl}`);

    this.axiosInstance = axios.create({
      baseURL: baseUrl,
      headers: {
        'X-N8N-API-KEY': API_KEY,
        'Content-Type': 'application/json',
        'Accept': 'application/json',
      },
      validateStatus: (status) => status < 500, // Don't throw for 4xx errors
    });

    this.setupTools();
    
    this.server.onerror = (error) => console.error('[MCP Error]', error);
    process.on('SIGINT', async () => {
      await this.server.close();
      process.exit(0);
    });
  }

  private setupTools() {
    this.server.setRequestHandler(ListToolsRequestSchema, async () => ({
      tools: [
        {
          name: 'list_workflows',
          description: 'List all workflows',
          inputSchema: {
            type: 'object',
            properties: {
              active: {
                type: 'boolean',
                description: 'Filter by active status'
              },
              tags: {
                type: 'array',
                items: { type: 'string' },
                description: 'Filter by tags'
              }
            }
          }
        },
        {
          name: 'get_workflow',
          description: 'Get a specific workflow by ID',
          inputSchema: {
            type: 'object',
            properties: {
              id: {
                type: 'string',
                description: 'Workflow ID'
              }
            },
            required: ['id']
          }
        },
        {
          name: 'create_workflow',
          description: 'Create a new workflow',
          inputSchema: {
            type: 'object',
            properties: {
              name: {
                type: 'string',
                description: 'Name of the workflow'
              },
              nodes: {
                type: 'array',
                description: 'Array of workflow nodes'
              },
              connections: {
                type: 'object',
                description: 'Node connections'
              },
              active: {
                type: 'boolean',
                description: 'Whether the workflow should be active'
              },
              tags: {
                type: 'array',
                items: { type: 'string' },
                description: 'Workflow tags'
              }
            },
            required: ['name']
          }
        },
        {
          name: 'update_workflow',
          description: 'Update an existing workflow',
          inputSchema: {
            type: 'object',
            properties: {
              id: {
                type: 'string',
                description: 'Workflow ID'
              },
              name: {
                type: 'string',
                description: 'Name of the workflow'
              },
              nodes: {
                type: 'array',
                description: 'Array of workflow nodes'
              },
              connections: {
                type: 'object',
                description: 'Node connections'
              },
              active: {
                type: 'boolean',
                description: 'Whether the workflow should be active'
              },
              tags: {
                type: 'array',
                items: { type: 'string' },
                description: 'Workflow tags'
              }
            },
            required: ['id']
          }
        },
        {
          name: 'delete_workflow',
          description: 'Delete a workflow',
          inputSchema: {
            type: 'object',
            properties: {
              id: {
                type: 'string',
                description: 'Workflow ID'
              }
            },
            required: ['id']
          }
        },
        {
          name: 'activate_workflow',
          description: 'Activate a workflow',
          inputSchema: {
            type: 'object',
            properties: {
              id: {
                type: 'string',
                description: 'Workflow ID'
              }
            },
            required: ['id']
          }
        },
        {
          name: 'deactivate_workflow',
          description: 'Deactivate a workflow',
          inputSchema: {
            type: 'object',
            properties: {
              id: {
                type: 'string',
                description: 'Workflow ID'
              }
            },
            required: ['id']
          }
        },
        {
          name: 'execute_workflow',
          description: 'Execute a workflow',
          inputSchema: {
            type: 'object',
            properties: {
              id: {
                type: 'string',
                description: 'Workflow ID'
              },
              data: {
                type: 'object',
                description: 'Input data for the workflow execution'
              }
            },
            required: ['id']
          }
        }
      ],
    }));

    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const args = request.params.arguments || {};
      
      try {
        switch (request.params.name) {
          case 'list_workflows':
            return this.handleListWorkflows(args as ListWorkflowsArgs);
          case 'get_workflow':
            return this.handleGetWorkflow(validateWorkflowId(args as Record<string, unknown>));
          case 'create_workflow':
            return this.handleCreateWorkflow(validateCreateWorkflow(args as Record<string, unknown>));
          case 'update_workflow':
            return this.handleUpdateWorkflow(validateUpdateWorkflow(args as Record<string, unknown>));
          case 'delete_workflow':
            return this.handleDeleteWorkflow(validateWorkflowId(args as Record<string, unknown>));
          case 'activate_workflow':
            return this.handleActivateWorkflow(validateWorkflowId(args as Record<string, unknown>));
          case 'deactivate_workflow':
            return this.handleDeactivateWorkflow(validateWorkflowId(args as Record<string, unknown>));
          case 'execute_workflow':
            return this.handleExecuteWorkflow(validateExecuteWorkflow(args as Record<string, unknown>));
          default:
            throw new McpError(
              ErrorCode.MethodNotFound,
              `Unknown tool: ${request.params.name}`
            );
        }
      } catch (error) {
        if (error instanceof AxiosError) {
          const message = error.response?.data?.message || error.message;
          console.error('[API Error]', error.response?.status, message);
          throw new McpError(ErrorCode.InternalError, `n8n API error: ${message}`);
        }
        throw error;
      }
    });
  }

  private async handleListWorkflows(args: ListWorkflowsArgs) {
    const params: Record<string, any> = {};
    if (args.active !== undefined) params.active = args.active;
    if (args.tags) params.tags = args.tags.join(',');

    try {
      console.error(`GET /workflows with params:`, params);
      const response = await this.axiosInstance.get('/workflows', { params });
      
      if (typeof response.data === 'string' && response.data.includes('<!DOCTYPE html>')) {
        console.error('Received HTML response instead of JSON. Ensure API_URL points to the API endpoint');
        return {
          content: [
            {
              type: 'text',
              text: "Error: Received HTML instead of JSON. Please check that N8N_API_URL points to the API endpoint (should end with /api/v1)"
            }
          ]
        };
      }
      
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(response.data, null, 2)
          }
        ]
      };
    } catch (error) {
      console.error('Error listing workflows:', error);
      throw error;
    }
  }

  private async handleGetWorkflow(args: WorkflowIdArg) {
    try {
      console.error(`GET /workflows/${args.id}`);
      const response = await this.axiosInstance.get(`/workflows/${args.id}`);
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(response.data, null, 2)
          }
        ]
      };
    } catch (error) {
      console.error(`Error getting workflow ${args.id}:`, error);
      throw error;
    }
  }

  private async handleCreateWorkflow(args: CreateWorkflowArgs) {
    const payload = {
      name: args.name,
      nodes: args.nodes || [],
      connections: args.connections || {},
      settings: args.settings || { executionOrder: "v1" }
    };

    try {
      console.error('POST /workflows', payload);
      const response = await this.axiosInstance.post('/workflows', payload);
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(response.data, null, 2)
          }
        ]
      };
    } catch (error) {
      console.error('Error creating workflow:', error);
      throw error;
    }
  }

  private async handleUpdateWorkflow(args: UpdateWorkflowArgs) {
    const { id, ...data } = args;
    
    try {
      console.error(`PATCH /workflows/${id}`, data);
      const response = await this.axiosInstance.patch(`/workflows/${id}`, data);
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(response.data, null, 2)
          }
        ]
      };
    } catch (error) {
      console.error(`Error updating workflow ${id}:`, error);
      throw error;
    }
  }

  private async handleDeleteWorkflow(args: WorkflowIdArg) {
    try {
      console.error(`DELETE /workflows/${args.id}`);
      const response = await this.axiosInstance.delete(`/workflows/${args.id}`);
      return {
        content: [
          {
            type: 'text',
            text: response.data ? JSON.stringify(response.data, null, 2) : `Workflow ${args.id} deleted successfully`
          }
        ]
      };
    } catch (error) {
      console.error(`Error deleting workflow ${args.id}:`, error);
      throw error;
    }
  }

  private async handleActivateWorkflow(args: WorkflowIdArg) {
    try {
      console.error(`POST /workflows/${args.id}/activate`);
      const response = await this.axiosInstance.post(`/workflows/${args.id}/activate`);
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(response.data, null, 2)
          }
        ]
      };
    } catch (error) {
      console.error(`Error activating workflow ${args.id}:`, error);
      throw error;
    }
  }

  private async handleDeactivateWorkflow(args: WorkflowIdArg) {
    try {
      console.error(`POST /workflows/${args.id}/deactivate`);
      const response = await this.axiosInstance.post(`/workflows/${args.id}/deactivate`);
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(response.data, null, 2)
          }
        ]
      };
    } catch (error) {
      console.error(`Error deactivating workflow ${args.id}:`, error);
      throw error;
    }
  }

  private async handleExecuteWorkflow(args: ExecuteWorkflowArgs) {
    try {
      console.error(`POST /workflows/${args.id}/execute`, args.data || {});
      const response = await this.axiosInstance.post(
        `/workflows/${args.id}/execute`, 
        args.data || {}
      );
      
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(response.data, null, 2)
          }
        ]
      };
    } catch (error) {
      console.error(`Error executing workflow ${args.id}:`, error);
      throw error;
    }
  }

  async run() {
    const transport = new StdioServerTransport();
    await this.server.connect(transport);
    console.error('n8n MCP server running on stdio');
  }
}

const server = new N8nServer();
server.run().catch(console.error);
