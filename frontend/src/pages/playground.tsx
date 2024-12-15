import React, { useState, useEffect, useRef } from 'react';
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import {
    Mic2,
    RefreshCcw,
    Play,
    StepForward,
    AlertCircle,
    Command,
    Rocket,
    ArrowRight,
    Loader,
    CircleStop,
    AudioLines,
    Circle,
    Mic,
    Square
} from 'lucide-react';
import {
    startBrowserBase,
    runInitialSteps,
    runAdditionalSteps,
    endWebagentSession,
    WebAgentRequestBody
} from '@/services/webagentService'
import ActivityMonitor from '@/components/ActivityMonitor';
import { useTranscriber } from '@/transcriber/use-transcriber';

import {
    LiveConnectionState,
    LiveTranscriptionEvent,
    LiveTranscriptionEvents,
    useDeepgram,
} from '@/context/DeepgramContextProvider'
import {
    MicrophoneEvents,
    MicrophoneState,
    useMicrophone,
} from '@/context/MicrophoneContextProvider'

type MessageType =
    | 'status'
    | 'browser'
    | 'thinking'
    | 'tool_calls'
    | 'tool_execution'
    | 'tool_result'
    | 'action'
    | 'complete';

interface WebAgentMessage {
    type: MessageType;
    message: string | {
        tool_call_id?: string;
        role?: string;
        name?: string;
        content?: string;
        response?: Array<{
            finish_reason: string;
            index: number;
            message: {
                content: string;
                role: string;
                tool_calls: null;
                function_call: null;
            }
        }>;
    };
}

interface PlaygroundStep {
    id: string;
    action: string;
    status: 'pending' | 'running' | 'complete' | 'error';
    isInitializing: boolean;
    type?: string;  // Add this for message type
    source: 'user' | 'system'; // Add this to distinguish between user and system messages
}

interface PlaygroundProps {
    initialSteps_: PlaygroundStep[];
    processId: string;
    onSessionEnd: () => void;
}

export default function Playground({
    initialSteps_,
    processId,
    onSessionEnd
}: PlaygroundProps) {

    const [startingUrl, setStartingUrl] = useState('');
    const [command, setCommand] = useState('');
    const [longTermMemory, setLongTermMemory] = useState(false);
    const [sessionStarted, setSessionStarted] = useState(false);
    const [steps, setSteps] = useState<PlaygroundStep[]>([]);
    const [isRunning, setIsRunning] = useState(false);
    const [browserUrl, setBrowserUrl] = useState('');
    const [sessionId, setSessionId] = useState('');

    // Deepgram and Microphone Setup
    const { connection, connectToDeepgram, connectionState } = useDeepgram();
    const {
        setupMicrophone,
        microphone,
        startMicrophone,
        microphoneState,
        stopMicrophone,
    } = useMicrophone();

    // Additional State for Mic Control
    const [transcriber, setTranscriber] = useState<boolean | null>(null);
    const [firstTimeListening, setFirstTimeListening] = useState<boolean | null>(null);
    const captionTimeout = useRef<any>();
    const keepAliveInterval = useRef<any>();

    // Set up Deepgram when microphone is ready
    useEffect(() => {
        if (microphoneState === MicrophoneState.Ready) {
            connectToDeepgram({
                model: "nova-2",
                interim_results: true,
                smart_format: true,
                filler_words: true,
                utterance_end_ms: 3000,
            });
        }
    }, [microphoneState]);

    // Handle microphone data streaming
    useEffect(() => {
        if (!microphone || !connection) return;

        const onData = (e: BlobEvent) => {
            connection?.send(e.data);
        };

        const onTranscript = (data: LiveTranscriptionEvent) => {

            const { is_final: isFinal, speech_final: speechFinal } = data;
            let thisCaption = data.channel.alternatives[0].transcript;
            console.log(thisCaption)

            if (thisCaption !== "" && isFinal && speechFinal) {
                setCommand(prev => prev + ' ' + thisCaption);
            }
        };

        if (connectionState === 1) {
            console.log('her??')
            connection.addListener(LiveTranscriptionEvents.Transcript, onTranscript);
            microphone.addEventListener(MicrophoneEvents.DataAvailable, onData);
            startMicrophone();
        }

        console.log('connection state is', connectionState == 1)

        return () => {
            connection?.removeListener(LiveTranscriptionEvents.Transcript, onTranscript);
            microphone?.removeEventListener(MicrophoneEvents.DataAvailable, onData);
            clearTimeout(captionTimeout.current);
        };


    }, [connectionState]);

    // Keep-alive connection management
    useEffect(() => {
        if (!connection) return;

        if (microphoneState !== MicrophoneState.Open) {
            connection.keepAlive();
            keepAliveInterval.current = setInterval(() => {
                connection.keepAlive();
            }, 10000);
        } else {
            clearInterval(keepAliveInterval.current);
        }

        return () => {
            clearInterval(keepAliveInterval.current);
        };
    }, [microphoneState, connectionState]);

    // Handle Microphone Toggle
    const handleMicrophoneToggle = async () => {
        if (transcriber === null) {
            if (firstTimeListening === null) {
                setupMicrophone();
                await new Promise(resolve => setTimeout(resolve, 2500));
                setFirstTimeListening(false);
            } else {
                setCommand("");
                startMicrophone();
            }
            setTranscriber(true);
        } else {
            stopMicrophone();
            setTranscriber(null);
        }
    };


    useEffect(() => {
        if (initialSteps_ && initialSteps_.length > 0) {
            setSteps(initialSteps_);
        }
        return () => {
            if (sessionId) {
                endWebagentSession(sessionId).catch(console.error);
            }
        };
    }, [initialSteps_]);

    const handleNewMessage = (message: string) => {
        try {
            const parsedMessage: WebAgentMessage = JSON.parse(message);

            // Format message based on type
            let displayMessage = '';
            switch (parsedMessage.type) {
                case 'tool_result':
                    const toolResult = parsedMessage.message as { content: string };
                    displayMessage = toolResult.content;
                    break;

                case 'complete':
                    const completeMsg = parsedMessage.message as {
                        response: Array<{ message: { content: string } }>;
                    };
                    displayMessage = completeMsg.response?.[0]?.message?.content || 'Task completed';
                    break;

                default:
                    displayMessage = parsedMessage.message as string;
            }

            setSteps(prev => {
                // Complete previous running steps
                const updatedSteps = prev.map(step => ({
                    ...step,
                    status: step.status === 'running' ? 'complete' : step.status
                }));

                // Special handling for 'complete' type
                if (parsedMessage.type === 'complete') {
                    return [...updatedSteps];
                }

                // Add new step
                return [...updatedSteps, {
                    id: Date.now().toString(),
                    action: displayMessage,
                    status: 'running',
                    isInitializing: false,
                    type: parsedMessage.type,
                    source: 'system'
                }];
            });

        } catch (e) {
            console.error('Error parsing message:', e);
        }
    };

    const handleSessionStart = async () => {
        if (!startingUrl) return;
        setIsRunning(true);

        try {
            const browserData = await startBrowserBase();
            if (browserData.live_browser_url && browserData.session_id) {
                setBrowserUrl(browserData.live_browser_url);
                setSessionId(browserData.session_id);
                setSessionStarted(true);
            }
        } catch (error) {
            console.error('Failed to start browser session:', error);
        } finally {
            setIsRunning(false);
        }
    };

    const handleCommandSubmit = async () => {
        if (!command.trim() || !sessionId) return;

        // Add user message
        const userStep: PlaygroundStep = {
            id: Date.now().toString(),
            action: command,
            status: 'complete',
            isInitializing: false,
            source: 'user'
        };

        setSteps(prev => [...prev, userStep]);
        setCommand('');
        setIsRunning(true);

        try {
            const requestBody: WebAgentRequestBody = {
                goal: command,
                starting_url: startingUrl,
                plan: '',
                session_id: sessionId
            };

            if (steps.length === 0) {
                await runInitialSteps(requestBody, handleNewMessage);
            } else {
                await runAdditionalSteps(requestBody, handleNewMessage);
            }
        } catch (error) {
            console.error('Command execution failed:', error);
            setSteps(prev => [...prev, {
                id: Date.now().toString(),
                action: 'Error executing command',
                status: 'error',
                isInitializing: false,
                source: 'system'
            }]);
        } finally {
            setIsRunning(false);
        }
    };

    const handleReset = async () => {
        if (sessionId) {
            try {
                await endWebagentSession(sessionId);
            } catch (error) {
                console.error('Failed to end session:', error);
            }
        }
        setCommand('');
        setSteps([]);
        setSessionStarted(false);
        setBrowserUrl('');
        setSessionId('');
        onSessionEnd();
        setStartingUrl('')
    };

    const exampleCommands = [
        {
            icon: <Command className="w-6 h-6" />,
            title: "Search dining table",
            description: "https://google.com"
        },
        // {
        //     icon: <Rocket className="w-6 h-6" />,
        //     title: "Add the book Zero to One in Hardcover",
        //     description: "to my Amazon cart"
        // },
        // {
        //     icon: <ArrowRight className="w-6 h-6" />,
        //     title: "What's the top post",
        //     description: "on Hackernews"
        // },
        // {
        //     icon: <Command className="w-6 h-6" />,
        //     title: "How much did NVIDIA stock",
        //     description: "gain today?"
        // }
    ];

    const handleExampleClick = async (command: any) => {
        setStartingUrl(command.description);
        // Start the session
        try {
            setIsRunning(true);
            const browserData = await startBrowserBase();
            if (browserData.live_browser_url && browserData.session_id) {
                setBrowserUrl(browserData.live_browser_url);
                setSessionId(browserData.session_id);
                setSessionStarted(true);

                // After session starts, submit the command
                const newStep = {
                    id: Date.now().toString(),
                    action: command.title,
                    status: 'running',
                    isInitializing: false
                };

                setSteps((prev: any) => [...prev, newStep]);

                const requestBody = {
                    goal: command.title,
                    starting_url: command.description,
                    plan: '',
                    session_id: browserData.session_id
                };

                await runInitialSteps(requestBody, handleNewMessage);

                setSteps(prev => prev.map(step =>
                    step.id === newStep.id ? { ...step, status: 'complete' } : step
                ));
            }
        } catch (error) {
            console.error('Failed to start session or run command:', error);
        } finally {
            setIsRunning(false);
        }
    };

    // Modified Input Section with Microphone Integration
    const renderCommandInput = () => (
        <div className="relative">
            <Input
                value={command}
                onChange={(e) => setCommand(e.target.value)}
                placeholder="Write a command..."
                className="h-12 pr-24 bg-gray-50/50 border-gray-200 focus:bg-white transition-all"
                onKeyPress={(e) => e.key === 'Enter' && handleCommandSubmit()}
                disabled={isRunning}
            />
            <div className="absolute right-1 top-1/2 -translate-y-1/2 flex space-x-1">
                <Button
                    variant="ghost"
                    size="icon"
                    className={`rounded-full w-10 h-10 ${transcriber === null
                        ? 'bg-blue-500 hover:bg-blue-600'
                        : 'bg-red-500 hover:bg-red-600'
                        }`}
                    onClick={handleMicrophoneToggle}
                    disabled={isRunning}
                >
                    {transcriber === null ? (
                        <Mic className="h-5 w-5 text-white" />
                    ) : (
                        <Square className="h-5 w-5 text-white" />
                    )}
                </Button>
                <Button
                    variant="ghost"
                    size="icon"
                    onClick={handleCommandSubmit}
                    disabled={isRunning}
                >
                    <Play className="w-5 h-5" />
                </Button>
            </div>
        </div>
    );

    // Helper functions
    const getMessageTypeStyle = (type?: string) => {
        switch (type) {
            case 'status':
                return 'border-blue-100 bg-blue-50/30';
            case 'browser':
                return 'border-purple-100 bg-purple-50/30';
            case 'thinking':
                return 'border-yellow-100 bg-yellow-50/30';
            case 'tool_calls':
            case 'tool_execution':
            case 'tool_result':
                return 'border-green-100 bg-green-50/30';
            case 'action':
                return 'border-orange-100 bg-orange-50/30';
            default:
                return 'border-gray-100';
        }
    };

    const getMessageTypeBadgeStyle = (type?: string) => {
        switch (type) {
            case 'status':
                return 'bg-blue-100 text-blue-700';
            case 'browser':
                return 'bg-purple-100 text-purple-700';
            case 'thinking':
                return 'bg-yellow-100 text-yellow-700';
            case 'tool_calls':
            case 'tool_execution':
            case 'tool_result':
                return 'bg-green-100 text-green-700';
            case 'action':
                return 'bg-orange-100 text-orange-700';
            default:
                return 'bg-gray-100 text-gray-700';
        }
    };

    const getMessageTypeLabel = (type?: string) => {
        switch (type) {
            case 'status':
                return 'Status Update';
            case 'browser':
                return 'Browser';
            case 'thinking':
                return 'Thinking';
            case 'tool_calls':
                return 'Tool Calls';
            case 'tool_execution':
                return 'Executing';
            case 'tool_result':
                return 'Result';
            case 'action':
                return 'Action';
            default:
                return 'System';
        }
    };

    return (
        <div className="min-h-screen bg-gradient-to-br from-gray-50 to-gray-100">
            <header className="border-b bg-white/80 backdrop-blur-sm supports-[backdrop-filter]:bg-white/60">
                <div className="flex items-center justify-between px-8 py-4">
                    <div className="flex items-center space-x-3">
                        <div className="bg-blue-500 text-white p-2 rounded-lg">
                            <Command className="w-5 h-5" />
                        </div>
                        <span className="font-semibold text-gray-800">Live Demo</span>
                    </div>
                    <div className="flex items-center space-x-4">
                        <ActivityMonitor
                            onInactive={handleReset}
                            isRunning={isRunning}
                            isSessionActive={sessionStarted}
                        // optionally you can add timeoutDuration={60} to change the default timeout
                        />
                        <Button
                            variant="ghost"
                            size="icon"
                            onClick={handleReset}
                            className="text-gray-600 hover:text-gray-900"
                        >
                            <AlertCircle className="w-5 h-5" />
                        </Button>
                    </div>
                </div>
            </header>

            <div className="flex h-[calc(100vh-64px)]">
                <div className="w-96 border-r bg-white/80 backdrop-blur-sm p-6 flex flex-col">
                    <div className="flex items-center space-x-3 mt-6 mb-6">
                        <div className="bg-blue-500 text-white p-2 rounded-lg">
                            <Command className="w-5 h-5" />
                        </div>
                        <div className="flex items-center space-x-2">
                            <span className="font-semibold text-lg text-gray-800">Lite Web Agent</span>

                        </div>
                    </div>

                    {!sessionStarted && (
                        <div className="space-y-4 mb-6">
                            <Input
                                value={startingUrl}
                                onChange={(e) => setStartingUrl(e.target.value)}
                                placeholder="Enter starting URL..."
                                className="bg-gray-50/50 border-gray-200 focus:bg-white transition-all"
                            />
                            <Button
                                className="w-full bg-blue-500 hover:bg-blue-600 text-white"
                                onClick={handleSessionStart}
                                disabled={!startingUrl || isRunning}
                            >
                                {isRunning ? 'Starting...' : 'Start Session'}
                            </Button>
                        </div>
                    )}

                    <div className="flex-1 overflow-y-auto space-y-3 scrollbar-thin scrollbar-thumb-gray-200">
                        {sessionStarted ? (
                            <>
                                {/* {steps.length === 0 && (
                                    <div className="text-sm text-gray-500 text-center p-8 bg-gray-50/50 rounded-lg">
                                        Enter your goal to begin the automated browsing session
                                    </div>
                                )} */}
                                {steps.map((step) => (
                                    <Card
                                        key={step.id}
                                        className={`p-4 border shadow-sm transition-all duration-300 hover:shadow-md ${step.source === 'user'
                                                ? 'border-gray-200 bg-white'
                                                : getMessageTypeStyle(step.type)
                                            }`}
                                    >
                                        <div className="flex justify-between items-start mb-2">
                                            <span className="text-sm font-medium text-gray-700">
                                                {getMessageTypeLabel(step.type)}
                                            </span>
                                            <div className="flex gap-2">
                                                <span className={`text-xs px-2.5 py-1 rounded-full font-medium ${getMessageTypeBadgeStyle(step.type)
                                                    }`}>
                                                    {step.type}
                                                </span>
                                            </div>
                                        </div>
                                        <p className="text-sm text-gray-800 whitespace-pre-wrap">{step.action}</p>
                                    </Card>
                                ))}
                            </>
                        ) : (
                            <>
                                {!isRunning && exampleCommands.map((command, index) => (
                                    <Card
                                        key={index}
                                        className="p-4 cursor-pointer hover:bg-gray-50/80 transition-all duration-200 border border-gray-100 shadow-sm hover:shadow-md"
                                        onClick={() => handleExampleClick(command)}
                                    >
                                        <div className="flex space-x-3">
                                            <div className="text-blue-500">
                                                {command.icon}
                                            </div>
                                            <div>
                                                <div className="font-medium text-gray-800">{command.title}</div>
                                                <div className="text-sm text-gray-500">{command.description}</div>
                                            </div>
                                        </div>
                                    </Card>
                                ))}
                            </>
                        )}
                    </div>

                    {sessionStarted && (
                        <div className="mt-auto pt-6 border-t border-gray-100">
                            <div className="mb-4 px-1">
                                <div className="text-sm text-gray-500">Starting URL:</div>
                                <div className="text-sm font-medium text-gray-900 truncate">{startingUrl}</div>
                            </div>
                            {renderCommandInput()}
                            <div className="flex justify-between mt-2">
                                <Button
                                    variant="outline"
                                    size="sm"
                                    className="text-gray-600 hover:text-gray-900"
                                    onClick={handleReset}
                                // disabled={isRunning}
                                >
                                    <RefreshCcw className="w-4 h-4 mr-2" />
                                    Start Over
                                </Button>
                            </div>
                        </div>
                    )}
                </div>

                <div className="flex-1 bg-white">
                    {browserUrl ? (
                        <iframe
                            src={browserUrl}
                            className="w-full h-full border-none"
                            sandbox="allow-same-origin allow-scripts"
                            allow="clipboard-read; clipboard-write"
                        />
                    ) : (
                        <div className="flex flex-col items-center justify-center h-full bg-gradient-to-br from-gray-50 to-gray-100">
                            <div className="bg-blue-500 text-white p-4 rounded-xl mb-6">
                                <Command className="w-8 h-8" />
                            </div>
                            <h2 className="text-2xl font-semibold text-gray-800 mb-2">Live Demo</h2>
                            <p className="text-gray-600">Your live preview will start here. To get started:</p>

                            <div className="mt-8 space-y-8 max-w-xl">
                                <div className="flex items-start space-x-4">
                                    <span className="flex items-center justify-center w-8 h-8 rounded-full bg-blue-100 text-blue-600 font-semibold">1</span>
                                    <p className="text-gray-600 mt-1">Enter your starting URL and goal to begin</p>
                                </div>

                                <div className="flex items-start space-x-4">
                                    <span className="flex items-center justify-center w-8 h-8 rounded-full bg-blue-100 text-blue-600 font-semibold">2</span>
                                    <p className="text-gray-600 mt-1">Once initialized, you can enter commands in the chat</p>
                                </div>

                                <div className="flex items-start space-x-4">
                                    <span className="flex items-center justify-center w-8 h-8 rounded-full bg-blue-100 text-blue-600 font-semibold">3</span>
                                    <p className="text-gray-600 mt-1">Watch as the automated browser follows your instructions</p>
                                </div>
                            </div>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}